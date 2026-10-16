import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, optionalContextFor } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { DocumentObjectStore } from "@/server/storage/documents";
import { archiveDocument, listDocuments, openDocumentFile, uploadDocument } from "./documents";
import { createLabReport, getLabReport, listLabReports, reviewLabReport, setLabReportShared, setLabReportValues } from "./lab-reports";

// P6.2 documents and lab reports against the live database, as the runtime
// role (sehat_app) with real RLS and the real app.* functions. Every test runs in
// ONE transaction that is rolled back, and files go to an in-memory fake object
// store — nothing is committed and no real file is stored. Synthetic files only;
// titles are obvious "ZZTEST" placeholders so leaks into audit data are detectable.
// Table counts are compared afterwards.

let admin: Client;
let adminA: TenantContext, adminB: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;
let nurseKothrud: TenantContext | undefined;
let assigned: string, unassigned: string;
let counts: Record<string, number>;

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  documents: await n(`SELECT count(*) n FROM patient_documents`),
  labReports: await n(`SELECT count(*) n FROM lab_reports`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  patients: await n(`SELECT count(*) n FROM patients`),
  invoices: await n(`SELECT count(*) n FROM invoices`),
  payments: await n(`SELECT count(*) n FROM payments`),
  objects: await n(`SELECT count(*) n FROM storage.objects WHERE bucket_id = 'patient-documents'`),
});

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
/** Distinct synthetic PNGs (trailing bytes after IEND change the checksum, not the image). */
const png = (i: number) => {
  const b = new Uint8Array(PNG.length + 4);
  b.set(PNG);
  new DataView(b.buffer).setUint32(PNG.length, i);
  return { bytes: b, name: `zztest-${i}.png`, type: "image/png" };
};
const pdf = (i: number) => ({ bytes: enc(`%PDF-1.4\n% zztest ${i}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`), name: `zztest-${i}.pdf`, type: "application/pdf" });

class FakeStore implements DocumentObjectStore {
  objects = new Map<string, Uint8Array>();
  failPut = false;
  corrupt = false;
  constructor(private timeline: string[]) {}
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw new Error("simulated storage outage");
    this.timeline.push("put");
    this.objects.set(key, bytes.slice());
  }
  async get(key: string) {
    this.timeline.push("get");
    const b = this.objects.get(key);
    if (!b) throw new Error("no such object");
    return this.corrupt ? Uint8Array.from(b, (x, i) => (i === b.length - 1 ? x ^ 1 : x)) : b;
  }
}

/** Records the order of explicit audit writes relative to storage calls. */
function traced(tx: TenantTx, timeline: string[]): TenantTx {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "$executeRaw") {
        return (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("app.log_event")) timeline.push(`audit:${String(values[0])}`);
          return target.$executeRaw(strings, ...values);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as TenantTx;
}

type Failure = { code?: string; name?: string };
/** A call the DATABASE may refuse: run it in a savepoint (PostgreSQL aborts the transaction on an error). */
async function dbAttempt(tx: TenantTx, fn: () => Promise<unknown>): Promise<string> {
  await tx.$executeRawUnsafe("SAVEPOINT p62_attempt");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT p62_attempt");
    return "OK";
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT p62_attempt");
    return (e as Failure).code ?? (e as Failure).name ?? "error";
  }
}
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: Failure) => e.code ?? e.name);
const ids = (page: { items: { id: string }[] }) => page.items.map((d) => d.id);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-02", "ST-04", "DR-01"]) ctxs.push(await contextFor(admin, k));
  [adminA, adminB, managerWakad, receptionWakad, doctor1] = ctxs;
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  assigned = (await admin.query(`SELECT "patientId" AS id FROM appointments WHERE "doctorId" = $1 ORDER BY "startsAt" LIMIT 1`, [FIX.doctor1])).rows[0].id;
  unassigned = (await admin.query(
    `SELECT p.id FROM patients p WHERE p."clinicId" = $1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a."patientId" = p.id AND a."doctorId" = $2) ORDER BY p."patientNumber" LIMIT 1`,
    [FIX.clinicA, FIX.doctor1]
  )).rows[0].id;
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("patient documents: upload, listing and download by role", () => {
  it("enforces the agreed matrix through RLS and the database functions; files are fetched only after an audited, authorized read", async () => {
    await inRollback(async ({ tx: raw, as }) => {
      const timeline: string[] = [];
      const tx = traced(raw, timeline);
      const store = new FakeStore(timeline);
      const deps = { store };
      const run = async <T,>(ctx: TenantContext, fn: () => Promise<T>) => {
        await as(ctx);
        return fn();
      };

      // Receptionist (Wakad): administrative upload, and a clinical (lab) upload she can't read back.
      const adminDoc = await run(receptionWakad, () => uploadDocument(receptionWakad, unassigned, png(1), { category: "ID_PROOF", title: "ZZTEST id" }, tx, deps));
      expect(adminDoc.readable).toBe(true);
      const labDoc = await run(receptionWakad, () => uploadDocument(receptionWakad, assigned, pdf(2), { category: "LAB_REPORT", title: "ZZTEST cbc", testType: "CBC" }, tx, deps));
      expect(labDoc).toMatchObject({ readable: false, category: "LAB_REPORT" });
      expect(labDoc.labReportId).toBeTruthy();
      expect([...store.objects.keys()].sort()).toEqual([`${FIX.clinicA}/${adminDoc.id}`, `${FIX.clinicA}/${labDoc.id}`].sort());

      const recList = await run(receptionWakad, () => listDocuments(receptionWakad, { patientId: undefined }, tx, deps));
      expect(ids(recList)).toContain(adminDoc.id);
      expect(ids(recList)).not.toContain(labDoc.id);
      expect(recList).toMatchObject({ canUploadClinical: true, canUploadAdministrative: true, canViewClinical: false });

      // Upload-only: opening the clinical file is NOT_FOUND, audited, and storage is never asked.
      const getsBefore = timeline.filter((t) => t === "get").length;
      expect(await run(receptionWakad, () => code(openDocumentFile(receptionWakad, labDoc.id, "attachment", tx, deps)))).toBe("NOT_FOUND");
      expect(timeline.filter((t) => t === "get").length).toBe(getsBefore);
      expect(timeline.at(-1)).toBe("audit:document.access_denied");

      // The receptionist opens the administrative file: identical bytes, inline image, audit BEFORE the fetch.
      const file = await run(receptionWakad, () => openDocumentFile(receptionWakad, adminDoc.id, "inline", tx, deps));
      expect(file.bytes).toEqual(png(1).bytes);
      expect(file).toMatchObject({ mimeType: "image/png", disposition: "inline", filename: "zztest-1.png" });
      expect(timeline.slice(-2)).toEqual(["audit:document.viewed", "get"]);

      // Clinic manager (Wakad): administrative only.
      const mgr = ids(await run(managerWakad, () => listDocuments(managerWakad, {}, tx, deps)));
      expect(mgr).toContain(adminDoc.id);
      expect(mgr).not.toContain(labDoc.id);
      expect(await run(managerWakad, () => code(uploadDocument(managerWakad, unassigned, pdf(3), { category: "IMAGING", title: "ZZTEST" }, tx, deps)))).toBe("FORBIDDEN");

      // Doctor: own patient's clinical file (uploaded in Wakad), never administrative files; PDFs download as attachments.
      const dr = ids(await run(doctor1, () => listDocuments(doctor1, {}, tx, deps)));
      expect(dr).toContain(labDoc.id);
      expect(dr).not.toContain(adminDoc.id);
      const drFile = await run(doctor1, () => openDocumentFile(doctor1, labDoc.id, "inline", tx, deps));
      expect(drFile).toMatchObject({ mimeType: "application/pdf", disposition: "attachment" });
      expect(await run(doctor1, () => code(openDocumentFile(doctor1, adminDoc.id, "inline", tx, deps)))).toBe("NOT_FOUND");
      // ...and can't upload for a patient they have no appointment with.
      await as(doctor1);
      expect(await dbAttempt(raw, () => uploadDocument(doctor1, unassigned, pdf(4), { category: "IMAGING", title: "ZZTEST" }, tx, deps))).toBe("NOT_FOUND");
      // A doctor's Kothrud upload for their own patient.
      const kthDoc = await run(doctor1, () => uploadDocument(doctor1, assigned, png(5), { category: "IMAGING", title: "ZZTEST xray", branchId: FIX.kothrud }, tx, deps));

      // Nurse (Kothrud): Kothrud clinical files only — not the Wakad lab file, not administrative files.
      if (nurseKothrud) {
        const nurse = nurseKothrud;
        const seen = ids(await run(nurse, () => listDocuments(nurse, {}, tx, deps)));
        expect(seen).toContain(kthDoc.id);
        expect(seen).not.toContain(labDoc.id);
        expect(seen).not.toContain(adminDoc.id);
      }

      // Administrator (clinic-wide): everything available in both branches.
      const all = ids(await run(adminA, () => listDocuments(adminA, {}, tx, deps)));
      for (const id of [adminDoc.id, labDoc.id, kthDoc.id]) expect(all).toContain(id);

      // Another clinic's administrator: nothing, and every function refuses.
      expect(ids(await run(adminB, () => listDocuments(adminB, {}, tx, deps)))).toEqual([]);
      expect(await run(adminB, () => code(openDocumentFile(adminB, adminDoc.id, "attachment", tx, deps)))).toBe("NOT_FOUND");
      await as(adminB);
      expect(await dbAttempt(raw, () => archiveDocument(adminB, adminDoc.id, { reason: "DUPLICATE" }, tx))).toBe("NOT_FOUND");
      expect(await dbAttempt(raw, () => uploadDocument(adminB, unassigned, png(6), { category: "ID_PROOF", title: "ZZTEST" }, tx, deps))).toBe("NOT_FOUND");

      // The same bytes twice for the same patient: refused as a duplicate.
      expect(await run(receptionWakad, () => code(uploadDocument(receptionWakad, unassigned, png(1), { category: "ID_PROOF", title: "ZZTEST again" }, tx, deps)))).toBe("DUPLICATE");

      // Audit trail: present, and free of titles, filenames and file contents.
      await as(adminA);
      const events = await raw.auditEvent.findMany({ where: { clinicId: FIX.clinicA, OR: [{ action: { startsWith: "document." } }, { action: { startsWith: "lab_report." } }, { action: { startsWith: "patient_documents." } }] } });
      const actions = new Set(events.map((e) => e.action));
      for (const a of ["document.uploaded", "document.viewed", "document.access_denied", "lab_report.created", "patient_documents.insert"]) expect(actions, a).toContain(a);
      for (const e of events) expect(`${JSON.stringify(e.metadata)} ${e.reason ?? ""}`, e.action).not.toMatch(/ZZTEST|zztest/i);
    });
  });
});

describe("failed uploads, integrity, archiving", () => {
  it("marks failed uploads, refuses corrupted files, archives with a reason and never deletes", async () => {
    await inRollback(async ({ tx: raw, as }) => {
      const timeline: string[] = [];
      const tx = traced(raw, timeline);
      const store = new FakeStore(timeline);
      const deps = { store };

      // Storage outage after registration: a 503, the row is FAILED (never listed), nothing stored.
      await as(receptionWakad);
      store.failPut = true;
      expect(await code(uploadDocument(receptionWakad, unassigned, png(10), { category: "CONSENT", title: "ZZTEST consent" }, tx, deps))).toBe("STORAGE_UNAVAILABLE");
      store.failPut = false;
      expect(store.objects.size).toBe(0);
      expect((await listDocuments(receptionWakad, { status: "all" }, tx, deps)).items).toEqual([]);
      await as(adminA); // the failure is audited by app.fail_patient_document_upload (reason code only)
      const failed = await raw.auditEvent.findMany({ where: { clinicId: FIX.clinicA, action: "document.upload_failed" }, select: { reason: true, metadata: true } });
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toBe("storage_error");
      await as(receptionWakad);

      // A stored file that no longer matches its checksum is not served.
      const doc = await uploadDocument(receptionWakad, unassigned, png(11), { category: "INSURANCE", title: "ZZTEST ins" }, tx, deps);
      store.corrupt = true;
      expect(await code(openDocumentFile(receptionWakad, doc.id, "attachment", tx, deps))).toBe("STORAGE_UNAVAILABLE");
      expect(timeline.at(-1)).toBe("audit:document.view_failed");
      store.corrupt = false;

      // Archive: receptionist no; clinic manager yes (reason required); then the file is gone (410), listed as archived.
      expect(await code(archiveDocument(receptionWakad, doc.id, { reason: "DUPLICATE" }, tx))).toBe("FORBIDDEN");
      await as(managerWakad);
      expect(await code(archiveDocument(managerWakad, doc.id, {}, tx))).toBe("ZodError");
      const archived = await archiveDocument(managerWakad, doc.id, { reason: "UPLOADED_IN_ERROR", note: "ZZTEST private note" }, tx);
      expect(archived).toMatchObject({ status: "ARCHIVED", archiveReason: "UPLOADED_IN_ERROR", canArchive: false });
      expect(await code(openDocumentFile(managerWakad, doc.id, "attachment", tx, deps))).toBe("GONE");
      expect(ids(await listDocuments(managerWakad, {}, tx, deps))).not.toContain(doc.id);
      expect(ids(await listDocuments(managerWakad, { status: "archived" }, tx, deps))).toContain(doc.id);
      expect(store.objects.has(`${FIX.clinicA}/${doc.id}`)).toBe(true); // archived files are kept

      // Clinical: the uploading doctor may archive their own recent upload; not someone else's.
      await as(doctor1);
      const own = await uploadDocument(doctor1, assigned, png(12), { category: "IMAGING", title: "ZZTEST" }, tx, deps);
      expect((await archiveDocument(doctor1, own.id, { reason: "ILLEGIBLE" }, tx)).status).toBe("ARCHIVED");
      await as(receptionWakad);
      const recLab = await uploadDocument(receptionWakad, assigned, pdf(13), { category: "LAB_REPORT", title: "ZZTEST", testType: "LFT" }, tx, deps);
      await as(doctor1);
      expect(await dbAttempt(raw, () => archiveDocument(doctor1, recLab.id, { reason: "DUPLICATE" }, tx))).toBe("FORBIDDEN");
      // An administrator may archive clinical files.
      await as(adminA);
      expect((await archiveDocument(adminA, recLab.id, { reason: "DUPLICATE" }, tx)).status).toBe("ARCHIVED");
    });
  });

  it("rate-limits uploads and lab reports to 30 per user per 10 minutes", async () => {
    await inRollback(async ({ tx, as }) => {
      const store = new FakeStore([]);
      await as(receptionWakad);
      for (let i = 0; i < 30; i++) {
        await tx.$queryRaw`SELECT document_id FROM app.begin_patient_document_upload(${unassigned}::uuid, 'ID_PROOF'::"DocumentCategory", 'ZZTEST', 'zztest.png', 'image/png', 10, ${"c".repeat(64)})`;
      }
      expect(await dbAttempt(tx, () => uploadDocument(receptionWakad, unassigned, png(99), { category: "ID_PROOF", title: "ZZTEST" }, tx, { store }))).toBe("RATE_LIMITED");
      expect(store.objects.size).toBe(0);

      await as(doctor1);
      for (let i = 0; i < 30; i++) await tx.$queryRaw`SELECT app.create_lab_report(${assigned}::uuid, 'ZZ', 'ZZTEST')`;
      expect(await dbAttempt(tx, () => createLabReport(doctor1, { patientId: assigned, testType: "CBC", title: "ZZTEST" }, tx))).toBe("RATE_LIMITED");
    });
  });
});

describe("lab reports: values, review, sharing", () => {
  it("follows the agreed workflow: upload-only creation, assigned-doctor review, sharing only after review, locking and re-review", async () => {
    await inRollback(async ({ tx, as }) => {
      const store = new FakeStore([]);
      // Receptionist registers a report (upload-only: can't read it back).
      await as(receptionWakad);
      const created = await createLabReport(receptionWakad, { patientId: assigned, testType: "CBC", title: "ZZTEST CBC" }, tx);
      expect(created.readable).toBe(false);
      expect(await listLabReports(receptionWakad, {}, tx)).toMatchObject({ items: [], canView: false, canCreate: true });
      expect(await code(getLabReport(receptionWakad, created.id, tx))).toBe("FORBIDDEN");

      // Doctor (assigned): pending → attach a result file → available.
      await as(doctor1);
      let r = await getLabReport(doctor1, created.id, tx);
      expect(r).toMatchObject({ status: "PENDING", actions: { canEditValues: true, canReview: false, canShare: false, canAttach: true } });
      const att = await uploadDocument(doctor1, assigned, pdf(20), { category: "LAB_REPORT", title: "ZZTEST cbc file", labReportId: created.id }, tx, { store });
      r = await getLabReport(doctor1, created.id, tx);
      expect(r.status).toBe("AVAILABLE");
      expect(r.attachments.map((a) => a.id)).toEqual([att.id]);

      // Values (strict), review, share; values lock while shared; unshare; new values clear the review.
      r = await setLabReportValues(doctor1, created.id, { values: [{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }, { parameter: "WBC", value: "" }], resultDate: "2026-10-13", notes: "ZZTEST note" }, tx);
      expect(r.values).toEqual([{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }, { parameter: "WBC" }]);
      expect(await code(setLabReportValues(doctor1, created.id, { values: [{ parameter: "Hb", dose: "1" }] }, tx))).toBe("ZodError");
      expect(await dbAttempt(tx, () => setLabReportShared(doctor1, created.id, true, tx))).toBe("NOT_REVIEWED");
      r = await reviewLabReport(doctor1, created.id, tx);
      expect(r).toMatchObject({ status: "REVIEWED", actions: { canShare: true, canReview: false } });
      r = await setLabReportShared(doctor1, created.id, true, tx);
      expect(r.sharedWithPatientAt).not.toBeNull();
      expect(r.actions.canEditValues).toBe(false);
      expect(await dbAttempt(tx, () => setLabReportValues(doctor1, created.id, { values: [] }, tx))).toBe("SHARED_LOCKED");
      r = await setLabReportShared(doctor1, created.id, false, tx);
      r = await setLabReportValues(doctor1, created.id, { values: [{ parameter: "Hb", value: "12.0" }] }, tx);
      expect(r).toMatchObject({ status: "AVAILABLE", reviewedAt: null, actions: { canReview: true } });
      r = await reviewLabReport(doctor1, created.id, tx);
      expect(r.status).toBe("REVIEWED");

      // Administrator: reads and may share, but never reviews (not a doctor).
      await as(adminA);
      expect((await getLabReport(adminA, created.id, tx)).status).toBe("REVIEWED");
      expect(await code(reviewLabReport(adminA, created.id, tx))).toBe("FORBIDDEN");
      expect((await setLabReportShared(adminA, created.id, true, tx)).sharedWithPatientAt).not.toBeNull();

      // Another clinic: not found.
      await as(adminB);
      expect(await code(getLabReport(adminB, created.id, tx))).toBe("NOT_FOUND");
      expect(await dbAttempt(tx, () => setLabReportShared(adminB, created.id, false, tx))).toBe("NOT_FOUND");

      // Nurse (Kothrud): a Kothrud report — reads and enters values, can't review; the Wakad report is invisible.
      if (nurseKothrud) {
        const nurse = nurseKothrud;
        await as(adminA);
        const kth = await createLabReport(adminA, { patientId: unassigned, testType: "LFT", title: "ZZTEST LFT", branchId: FIX.kothrud }, tx);
        await as(nurse);
        expect((await setLabReportValues(nurse, kth.id, { values: [{ parameter: "ALT", value: "30" }] }, tx)).status).toBe("AVAILABLE");
        expect(await code(reviewLabReport(nurse, kth.id, tx))).toBe("FORBIDDEN");
        expect(await code(getLabReport(nurse, created.id, tx))).toBe("NOT_FOUND");
      }

      // Audit: values, notes and titles never appear.
      await as(adminA);
      const events = await tx.auditEvent.findMany({ where: { clinicId: FIX.clinicA, action: { startsWith: "lab_report" } } });
      expect(new Set(events.map((e) => e.action))).toEqual(new Set(["lab_report.created", "lab_report.values_updated", "lab_report.reviewed", "lab_report.shared", "lab_report.unshared", "lab_reports.insert", "lab_reports.update"]));
      for (const e of events) expect(`${JSON.stringify(e.metadata)} ${e.reason ?? ""}`).not.toMatch(/ZZTEST|13\.1|Hb|g\/dL/);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, patientContextFor, pinPatient } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import type { PatientContext, TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { DocumentObjectStore } from "@/server/storage/documents";
import { archiveDocument, openPatientDocumentFile, uploadDocument } from "./documents";
import { createLabReport, getLabReport, reviewLabReport, setLabReportShared, setLabReportValues } from "./lab-reports";
import { getMyLabReport, getPortalSummary, listMyDocuments, listMyLabReports } from "./portal";

// P6.3 patient portal against the live database, as the runtime role with real
// RLS: the fictional portal user PU-01 (linked to Aarogya patient #1) and
// staff fixtures that create, review and share reports inside ONE transaction
// that is rolled back. Files go to an in-memory fake store. Synthetic data
// only ("ZZTEST"); nothing is committed (table counts are compared afterwards).

let admin: Client;
let adminA: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;
let portal: PatientContext;
let otherPatient: string;
let counts: Record<string, number>;
const PORTAL_PATIENT = demoId("patient:1");

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  documents: await n(`SELECT count(*) n FROM patient_documents`),
  labReports: await n(`SELECT count(*) n FROM lab_reports`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  memberships: await n(`SELECT count(*) n FROM clinic_memberships WHERE status = 'ACTIVE'`),
  objects: await n(`SELECT count(*) n FROM storage.objects WHERE bucket_id = 'patient-documents'`),
});

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (i: number) => ({ bytes: enc(`%PDF-1.4\n% zztest portal ${i}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`), name: `zztest-${i}.pdf`, type: "application/pdf" });

class FakeStore implements DocumentObjectStore {
  objects = new Map<string, Uint8Array>();
  gets: string[] = [];
  constructor(private timeline: string[]) {}
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes.slice());
  }
  async get(key: string) {
    this.gets.push(key);
    this.timeline.push("get");
    const b = this.objects.get(key);
    if (!b) throw new Error("no such object");
    return b;
  }
}

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

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
const ids = (page: { items: { id: string }[] }) => page.items.map((x) => x.id).sort();

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  [adminA, receptionWakad, doctor1] = [await contextFor(admin, "ST-01"), await contextFor(admin, "ST-04"), await contextFor(admin, "DR-01")];
  portal = await patientContextFor(admin, "PU-01");
  expect(portal).toMatchObject({ clinicId: FIX.clinicA, patientIds: [PORTAL_PATIENT] });
  // Both patients must have an appointment with DR-01 so the assigned doctor can review their reports.
  const drPatients = (await admin.query(`SELECT DISTINCT "patientId" AS id FROM appointments WHERE "doctorId" = $1`, [FIX.doctor1])).rows.map((r) => r.id as string);
  expect(drPatients, "fixture: patient #1 has a DR-01 appointment").toContain(PORTAL_PATIENT);
  otherPatient = drPatients.find((p) => p !== PORTAL_PATIENT)!;
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("patient portal: own reviewed, shared lab reports and their files only", () => {
  it("enforces eligibility, ownership, clinic scope, unsharing and revocation, and audits views and denials", async () => {
    await inRollback(async ({ tx: raw, as }) => {
      const timeline: string[] = [];
      const tx = traced(raw, timeline);
      const store = new FakeStore(timeline);
      const deps = { store };
      const staff = async <T,>(ctx: TenantContext, fn: () => Promise<T>) => {
        await as(ctx);
        return fn();
      };
      const asPortal = async <T,>(fn: () => Promise<T>, ctx: PatientContext = portal) => {
        await pinPatient(raw, ctx);
        return fn();
      };
      const report = async (patientId: string, title: string) => (await createLabReport(doctor1, { patientId, testType: "CBC", title }, tx)).id;

      // --- Fixtures (all created by staff inside this rolled-back transaction) --------------------
      await as(doctor1);
      const shared = await report(PORTAL_PATIENT, "ZZTEST shared");
      await setLabReportValues(doctor1, shared, { values: [{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }], notes: "ZZTEST internal note" }, tx);
      const file = await uploadDocument(doctor1, PORTAL_PATIENT, pdf(1), { category: "LAB_REPORT", title: "ZZTEST file", labReportId: shared }, tx, deps);
      const archivedFile = await uploadDocument(doctor1, PORTAL_PATIENT, pdf(2), { category: "LAB_REPORT", title: "ZZTEST old file", labReportId: shared }, tx, deps);
      await reviewLabReport(doctor1, shared, tx);
      await setLabReportShared(doctor1, shared, true, tx);
      const reviewedOnly = await report(PORTAL_PATIENT, "ZZTEST reviewed not shared");
      await setLabReportValues(doctor1, reviewedOnly, { values: [{ parameter: "x" }] }, tx);
      const unsharedFile = await uploadDocument(doctor1, PORTAL_PATIENT, pdf(3), { category: "LAB_REPORT", title: "ZZTEST", labReportId: reviewedOnly }, tx, deps);
      await reviewLabReport(doctor1, reviewedOnly, tx);
      const availableOnly = await report(PORTAL_PATIENT, "ZZTEST available");
      await setLabReportValues(doctor1, availableOnly, { values: [{ parameter: "x" }] }, tx);
      const pending = await report(PORTAL_PATIENT, "ZZTEST pending");
      const othersShared = await report(otherPatient, "ZZTEST other patient");
      await setLabReportValues(doctor1, othersShared, { values: [{ parameter: "x" }] }, tx);
      const othersFile = await uploadDocument(doctor1, otherPatient, pdf(4), { category: "LAB_REPORT", title: "ZZTEST", labReportId: othersShared }, tx, deps);
      await reviewLabReport(doctor1, othersShared, tx);
      await setLabReportShared(doctor1, othersShared, true, tx);
      const idProof = await staff(receptionWakad, () => uploadDocument(receptionWakad, PORTAL_PATIENT, pdf(5), { category: "ID_PROOF", title: "ZZTEST id" }, tx, deps));
      await staff(adminA, () => archiveDocument(adminA, archivedFile.id, { reason: "SUPERSEDED" }, tx));

      // --- The patient sees exactly the one shared report and its one available file -------------
      expect(ids(await asPortal(() => listMyLabReports(portal, {}, tx)))).toEqual([shared]);
      const detail = await asPortal(() => getMyLabReport(portal, shared, tx));
      expect(detail.values).toEqual([{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }]);
      expect(detail.files.map((f) => f.id)).toEqual([file.id]);
      expect(Object.keys(detail)).not.toEqual(expect.arrayContaining(["notes"]));
      expect(JSON.stringify(detail)).not.toMatch(/ZZTEST internal note|storageKey|sha256|patientId|reviewedByUserId|createdByUserId/);
      expect(ids(await asPortal(() => listMyDocuments(portal, {}, tx)))).toEqual([file.id]);
      expect(await asPortal(() => getPortalSummary(portal, tx))).toMatchObject({ reportCount: 1, documentCount: 1, patient: { patientNumber: expect.any(String) } });

      // The file: identical bytes, audited BEFORE the fetch.
      const got = await asPortal(() => openPatientDocumentFile(portal, file.id, "inline", tx, deps));
      expect(got.bytes).toEqual(pdf(1).bytes);
      expect(got.disposition).toBe("attachment"); // PDFs always download
      expect(timeline.slice(-2)).toEqual(["audit:document.viewed", "get"]);

      // --- Everything else is the same 404, and storage is never asked -----------------------------
      const getsBefore = store.gets.length;
      for (const id of [reviewedOnly, availableOnly, pending, othersShared, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
        expect(await asPortal(() => code(getMyLabReport(portal, id, tx))), id).toBe("NOT_FOUND");
      }
      for (const id of [archivedFile.id, unsharedFile.id, othersFile.id, idProof.id, "00000000-0000-4000-8000-000000000000"]) {
        expect(await asPortal(() => code(openPatientDocumentFile(portal, id, "attachment", tx, deps))), id).toBe("NOT_FOUND");
      }
      expect(store.gets.length).toBe(getsBefore);

      // Another clinic (a forged context): nothing at all.
      const forged = { ...portal, clinicId: FIX.clinicB };
      expect((await asPortal(() => listMyLabReports(forged, {}, tx), forged)).items).toEqual([]);
      expect(await asPortal(() => code(openPatientDocumentFile(forged, file.id, "attachment", tx, deps)), forged)).toBe("NOT_FOUND");
      // A stale context naming someone else's record: the database still derives the patient from the link.
      const tampered = { ...portal, patientIds: [otherPatient] };
      expect((await asPortal(() => listMyLabReports(tampered, {}, tx), tampered)).items).toEqual([]);
      expect(await asPortal(() => code(openPatientDocumentFile(tampered, othersFile.id, "attachment", tx, deps)), tampered)).toBe("NOT_FOUND");

      // --- Unsharing withdraws access immediately -------------------------------------------------
      await staff(doctor1, () => setLabReportShared(doctor1, shared, false, tx));
      expect((await asPortal(() => listMyLabReports(portal, {}, tx))).items).toEqual([]);
      expect(await asPortal(() => code(getMyLabReport(portal, shared, tx)))).toBe("NOT_FOUND");
      expect(await asPortal(() => code(openPatientDocumentFile(portal, file.id, "attachment", tx, deps)))).toBe("NOT_FOUND");

      // --- Revoking the portal membership cuts access at the database, even with a stale server context ---
      await staff(doctor1, () => setLabReportShared(doctor1, shared, true, tx));
      expect(ids(await asPortal(() => listMyLabReports(portal, {}, tx)))).toEqual([shared]);
      await as(adminA);
      const revoked = await raw.clinicMembership.updateMany({ where: { id: demoId("membership:PU-01") }, data: { status: "INACTIVE" } });
      expect(revoked.count).toBe(1);
      expect((await asPortal(() => listMyLabReports(portal, {}, tx))).items).toEqual([]);
      expect(await asPortal(() => code(openPatientDocumentFile(portal, file.id, "attachment", tx, deps)))).toBe("NOT_FOUND");

      // Staff access is unaffected.
      expect((await staff(doctor1, () => getLabReport(doctor1, shared, tx))).status).toBe("REVIEWED");

      // --- Audit: views and denials recorded for the patient, without clinical content --------------
      await as(adminA);
      const events = await raw.auditEvent.findMany({
        where: { clinicId: FIX.clinicA, actorUserId: portal.userId, action: { in: ["lab_report.viewed", "lab_report.access_denied", "document.viewed", "document.access_denied"] } },
        select: { action: true, outcome: true, targetId: true, metadata: true, reason: true },
      });
      const byAction = (a: string) => events.filter((e) => e.action === a);
      expect(byAction("lab_report.viewed").map((e) => e.targetId)).toEqual([shared]);
      expect(byAction("document.viewed").map((e) => e.targetId)).toEqual([file.id]);
      // 5 refused report ids (a malformed id is refused before any lookup) + the unshared one;
      // 5 refused files + tampered + unshared + revoked (the forged-clinic denial is recorded under that other clinic).
      expect(byAction("lab_report.access_denied")).toHaveLength(6);
      expect(byAction("document.access_denied")).toHaveLength(8);
      for (const e of events) {
        expect((e.metadata as { portal?: boolean } | null)?.portal, e.action).toBe(true);
        expect(`${JSON.stringify(e.metadata)} ${e.reason ?? ""}`).not.toMatch(/ZZTEST|zztest|13\.1|Hb/);
      }
    });
  });
});

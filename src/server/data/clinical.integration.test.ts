import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate, optionalContextFor, present } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { createAppointment, getAvailableSlots, getAppointment, transitionAppointment } from "./appointments";
import {
  completeConsultation,
  createPrescription,
  getConsultation,
  getPatientTimeline,
  getPrescription,
  listConsultations,
  listPrescriptions,
  startConsultation,
  updateConsultation,
} from "./clinical";
import { searchCatalog } from "./medicines";

// Consultations and prescriptions against the live database, as real
// (fictional) fixture users. Writes are rolled back and table counts compared
// afterwards. No real or invented medical content is persisted: test notes are
// obvious placeholders and disappear with the rollback.

let admin: Client;
let adminA: TenantContext; // Aarogya administrator: reads clinical records, may not author them
let adminB: TenantContext; // Nirmaya administrator
let receptionWakad: TenantContext; // no clinical permissions
let nurseKothrud: TenantContext | undefined; // no consultation read permission
let doctor1: TenantContext; // Dr. DR-01 (own scope)
let doctor2: TenantContext; // Dr. DR-02 (own scope)
let counts: Record<string, number>;

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  consultations: await n(`SELECT count(*) n FROM consultations`),
  prescriptions: await n(`SELECT count(*) n FROM prescriptions`),
  items: await n(`SELECT count(*) n FROM prescription_items`),
  appointments: await n(`SELECT count(*) n FROM appointments`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-04", "DR-01", "DR-02"]) ctxs.push(await contextFor(admin, k)); // one pg client: sequential
  [adminA, adminB, receptionWakad, doctor1, doctor2] = ctxs;
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("reading clinical records", () => {
  it("shows administrators the clinic's consultations and doctors only their own", async () => {
    expect((await listConsultations(adminA, { pageSize: 100 })).total).toBe(await n(`SELECT count(*) n FROM consultations WHERE "clinicId" = $1`, [FIX.clinicA]));
    const mine = await listConsultations(doctor1, { pageSize: 100, doctorId: FIX.doctor2 }); // asking for another doctor doesn't widen scope
    expect(mine.total).toBe(await n(`SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1`, [FIX.doctor1]));
    expect(mine.items.every((c) => c.doctorId === FIX.doctor1)).toBe(true);
  });

  it("gives front-desk and nursing roles no access to notes or prescriptions — in the app and in RLS", async () => {
    for (const ctx of present(receptionWakad, nurseKothrud)) {
      expect(await code(listConsultations(ctx, {}))).toBe("FORBIDDEN");
      expect(await code(listPrescriptions(ctx, {}))).toBe("FORBIDDEN");
    }
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad);
      expect((await tx.consultation.count()) + (await tx.prescription.count())).toBe(0);
    });
  });

  it("keeps doctors and clinics apart on direct access", async () => {
    const other = (await admin.query(`SELECT c.id FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1 LIMIT 1`, [FIX.doctor2])).rows[0];
    expect(await code(getConsultation(doctor1, other.id))).toBe("NOT_FOUND");
    expect(await code(getConsultation(adminB, other.id))).toBe("NOT_FOUND");
    expect((await getConsultation(adminA, other.id)).capabilities).toEqual({ edit: false, prescribe: false }); // admins read, don't author
  });

  it("returns prescriptions with catalogue medicines and matching item counts", async () => {
    const page = await listPrescriptions(adminA, { pageSize: 100 });
    expect(page.total).toBe(await n(`SELECT count(*) n FROM prescriptions WHERE "clinicId" = $1`, [FIX.clinicA]));
    const rx = page.items[0];
    const detail = await getPrescription(adminA, rx.id);
    expect(detail.items.length).toBe(await n(`SELECT count(*) n FROM prescription_items WHERE "prescriptionId" = $1`, [rx.id]));
    expect(detail.prescriptionNumber).toMatch(/^AAR-RX-\d{4}$/);
    expect(detail.aiReviewFlags).toEqual([]);
  });

  it("lists the medicine catalogue for prescribers only", async () => {
    const page = await searchCatalog(doctor1, {});
    expect(page.total).toBe(await n(`SELECT count(*) n FROM medicines WHERE "isActive"`));
    expect(page.canCreate).toBe(false); // doctors prescribe from the catalogue but can't add to it
    expect(await code(searchCatalog(receptionWakad, {}))).toBe("FORBIDDEN");
  });

  it("builds each user's patient timeline from what they may see", async () => {
    const patientId = (await admin.query(`SELECT a."patientId" FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1 LIMIT 1`, [FIX.doctor1])).rows[0].patientId;
    const doctorView = await getPatientTimeline(doctor1, patientId);
    expect(doctorView.filter((e) => e.type === "consultation").length).toBe(
      await n(`SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."patientId" = $1 AND a."doctorId" = $2`, [patientId, FIX.doctor1])
    );
    expect(doctorView.some((e) => e.type === "invoice")).toBe(false); // doctors have no billing access
    const frontDesk = await getPatientTimeline(receptionWakad, patientId);
    expect(frontDesk.every((e) => e.type === "invoice")).toBe(true); // no clinical events
  });
});

/** A fresh appointment for doctor 1, booked (and by default checked in) at Wakad inside the rollback transaction. */
async function checkedInAppointment(tx: TenantTx, as: (ctx: TenantContext) => Promise<void>, checkIn = true): Promise<string> {
  const patientId = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 1`, [FIX.clinicA])).rows[0].id;
  await as(receptionWakad);
  for (let day = 1; day <= 7; day++) {
    const date = istDate(day);
    const slots = await getAvailableSlots(receptionWakad, FIX.doctor1, date, tx);
    if (!slots.length) continue;
    const appt = await createAppointment(receptionWakad, { patientId, doctorId: FIX.doctor1, branchId: FIX.wakad, date, time: slots[0], type: "in_person", reason: "Integration test visit" }, tx);
    if (checkIn) await transitionAppointment(receptionWakad, appt.id, "check-in", tx);
    return appt.id;
  }
  throw new Error("No free slot for doctor 1 in the next week");
}

describe("consultation lifecycle (assigned doctor only)", () => {
  it("starts, saves, prescribes and completes — and refuses everyone else", async () => {
    const medicines = (await admin.query(`SELECT id FROM medicines WHERE "isActive" ORDER BY name LIMIT 2`)).rows.map((r) => r.id as string);
    const maxRx = await n(`SELECT coalesce(max(substr("prescriptionNumber", 8)::int), 0) n FROM prescriptions WHERE "clinicId" = $1 AND "prescriptionNumber" ~ '^AAR-RX-[0-9]+$'`, [FIX.clinicA]);
    await inRollback(async ({ tx, as }) => {
      const apptId = await checkedInAppointment(tx, as);

      // Only the assigned doctor may start it.
      await as(adminA);
      expect(await code(startConsultation(adminA, apptId, tx))).toBe("FORBIDDEN");
      await as(doctor2);
      expect(await code(startConsultation(doctor2, apptId, tx))).toBe("NOT_FOUND");
      await as(receptionWakad);
      expect(await code(startConsultation(receptionWakad, apptId, tx))).toBe("FORBIDDEN");

      await as(doctor1);
      const started = await startConsultation(doctor1, apptId, tx);
      expect(started).toMatchObject({ status: "in_progress", chiefComplaint: "Integration test visit", capabilities: { edit: true, prescribe: true } });
      expect((await getAppointment(doctor1, apptId, tx)).status).toBe("in_consultation");
      expect((await startConsultation(doctor1, apptId, tx)).id).toBe(started.id); // idempotent

      // Draft: validated, persisted, BMI derived on the server.
      const saved = await updateConsultation(
        doctor1,
        started.id,
        { symptoms: ["TEST-SYMPTOM"], vitals: { weightKg: 70, heightCm: 175, bmi: 1 }, clinicalNotes: "TEST NOTE", followUpDate: istDate(30) },
        tx
      );
      expect(saved).toMatchObject({ symptoms: ["TEST-SYMPTOM"], clinicalNotes: "TEST NOTE", vitals: { weightKg: 70, heightCm: 175, bmi: 22.9 } });
      expect((await getConsultation(doctor1, started.id, tx)).clinicalNotes).toBe("TEST NOTE");
      expect(await code(updateConsultation(doctor1, started.id, { vitals: { spo2: 140 } }, tx))).toBe("ZodError");
      expect(await code(updateConsultation(doctor1, started.id, { status: "completed" }, tx))).toBe("ZodError"); // not an editable field
      expect(await code(updateConsultation(doctor1, started.id, { followUpDate: "2000-01-01" }, tx))).toBe("INVALID_INPUT");

      // The audit trail records which columns changed, never their values.
      await as(adminA);
      const audit = await tx.auditEvent.findMany({ where: { action: "consultations.update", targetId: started.id }, select: { metadata: true } });
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toMatch(/TEST NOTE|TEST-SYMPTOM/);
      // Administrators can't author, in the app or directly in the database (RLS).
      expect(await code(updateConsultation(adminA, started.id, { clinicalNotes: "x" }, tx))).toBe("FORBIDDEN");
      expect((await tx.consultation.updateMany({ where: { id: started.id }, data: { notes: "x" } })).count).toBe(0);
      expect(await code(createPrescription(adminA, { consultationId: started.id, items: [{ medicineId: medicines[0], dosage: "1", frequency: "OD", durationDays: 1 }] }, tx))).toBe("FORBIDDEN");

      // Prescription: catalogue medicines only, numbered clinic-wide.
      await as(doctor1);
      const item = { medicineId: medicines[0], dosage: "1 tablet", frequency: "Twice daily", durationDays: 5, route: "Oral" };
      expect(await code(createPrescription(doctor1, { consultationId: started.id, items: [{ ...item, medicineId: "00000000-0000-4000-8000-000000000000" }] }, tx))).toBe("INVALID_INPUT");
      expect(await code(createPrescription(doctor1, { consultationId: started.id, items: [{ ...item, durationDays: 0 }] }, tx))).toBe("ZodError");
      expect(await code(createPrescription(doctor1, { consultationId: started.id, items: [] }, tx))).toBe("ZodError");
      const rx = await createPrescription(doctor1, { consultationId: started.id, items: [item, { ...item, medicineId: medicines[1], durationDays: 1 }] }, tx);
      expect(rx.prescriptionNumber).toBe(`AAR-RX-${String(maxRx + 1).padStart(4, "0")}`);
      expect(rx.items.map((i) => i.duration).sort()).toEqual(["1 day", "5 days"]);
      expect(rx.items.every((i) => i.route === "Oral")).toBe(true);
      const names = rx.items.map((i) => i.medicineName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b))); // stable order by medicine name
      expect((await getConsultation(doctor1, started.id, tx)).prescriptionId).toBe(rx.id);

      // Complete: consultation and appointment both close; no more edits.
      const done = await completeConsultation(doctor1, started.id, { diagnosis: ["TEST-DX"] }, tx);
      expect(done).toMatchObject({ status: "completed", diagnosis: ["TEST-DX"], capabilities: { edit: false } });
      expect((await getAppointment(doctor1, apptId, tx)).status).toBe("completed");
      expect(await code(updateConsultation(doctor1, started.id, { clinicalNotes: "late" }, tx))).toBe("INVALID_TRANSITION");
      expect(await code(completeConsultation(doctor1, started.id, {}, tx))).toBe("INVALID_TRANSITION");
    });
  });

  it("won't start a consultation before check-in", async () => {
    await inRollback(async ({ tx, as }) => {
      const apptId = await checkedInAppointment(tx, as, false);
      await as(doctor1);
      expect(await code(startConsultation(doctor1, apptId, tx))).toBe("INVALID_TRANSITION");
    });
  });
});

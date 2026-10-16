import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate, patientContextFor, pinPatient } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import type { PatientContext, TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { createAppointment } from "./appointments";
import { bookMyAppointment, cancelMyAppointment, getMyAppointment, getMySlots, listMyAppointments, rescheduleMyAppointment } from "./portal-booking";

// Patient self-booking (migration 20261028000000) against the live database, as
// the runtime role with real RLS: the fictional portal user PU-01 (Aarogya
// patient #1) and staff fixtures, inside ONE transaction that is rolled back.
// Synthetic reasons only ("ZZTEST"); table counts are compared afterwards.
// Needs the migration applied to the TEST database: npm run test:integration.

let admin: Client;
let reception: TenantContext;
let portal: PatientContext;
let otherPatient: string;
let counts: Record<string, number>;
const PORTAL_PATIENT = demoId("patient:1");

const n = async (sql: string) => Number((await admin.query(sql)).rows[0].n);
const tableCounts = async () => ({ appointments: await n(`SELECT count(*) n FROM appointments`), symptoms: await n(`SELECT count(*) n FROM patient_symptom_reports`) });

/** Runs a call that may be refused inside a SAVEPOINT (PostgreSQL aborts the transaction on any error); returns the error code or "OK". */
async function codeIn(tx: TenantTx, fn: () => Promise<unknown>): Promise<string> {
  await tx.$executeRawUnsafe("SAVEPOINT booking_attempt");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT booking_attempt");
    return "OK";
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT booking_attempt");
    return (e as { code?: string }).code ?? (e as Error).name;
  }
}

/** A Monday–Saturday IST date a few days out. */
function weekday(offset: number): string {
  for (let i = offset; ; i++) {
    const d = istDate(i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) return d;
  }
}

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  reception = await contextFor(admin, "ST-01");
  portal = await patientContextFor(admin, "PU-01");
  expect(portal).toMatchObject({ clinicId: FIX.clinicA, patientIds: [PORTAL_PATIENT] });
  otherPatient = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND id <> $2 AND status = 'ACTIVE' LIMIT 1`, [FIX.clinicA, PORTAL_PATIENT])).rows[0].id;
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("patient self-booking", () => {
  it("books only free standard slots, prevents double bookings, and keeps every patient to their own appointments", async () => {
    await inRollback(async ({ tx, as }) => {
      const asPortal = async <T,>(fn: () => Promise<T>, ctx: PatientContext = portal) => {
        await pinPatient(tx, ctx);
        return fn();
      };
      const date = weekday(3);
      const free = (await asPortal(() => getMySlots(portal, { doctorId: FIX.doctor1, branchId: FIX.kothrud, date }, tx))).slots;
      expect(free.length, "fixture: DR-01 has free slots").toBeGreaterThan(2);
      const [t1, t2, t3] = free;

      // Book: own record, SCHEDULED, standard slot; symptoms saved in the same transaction.
      const booked = await asPortal(() =>
        bookMyAppointment(portal, { branchId: FIX.kothrud, doctorId: FIX.doctor1, date, time: t1, reason: "ZZTEST checkup",
          symptoms: { requestId: crypto.randomUUID(), symptoms: "ZZTEST cough", onset: "DAYS_1_3", severity: "MILD" } }, tx)
      );
      expect(booked).toMatchObject({ date, time: t1, status: "scheduled", canCancel: true, canReschedule: true });
      const row = (await tx.$queryRaw<{ patientId: string; status: string }[]>`SELECT "patientId"::text AS "patientId", status::text FROM appointments WHERE id = ${booked.id}::uuid`)[0];
      expect(row).toEqual({ patientId: PORTAL_PATIENT, status: "SCHEDULED" });
      expect((await asPortal(() => getMySlots(portal, { doctorId: FIX.doctor1, branchId: FIX.kothrud, date }, tx))).slots).not.toContain(t1);

      // Conflicts and duplicates, from the patient and from staff.
      const book = (patch: Record<string, unknown>) => asPortal(() => codeIn(tx, () => bookMyAppointment(portal, { branchId: FIX.kothrud, doctorId: FIX.doctor1, date, time: t2, reason: "ZZTEST", ...patch }, tx)));
      expect(await book({ time: t1 })).toBe("SLOT_TAKEN"); // same doctor + time
      expect(await book({ doctorId: FIX.doctor2, time: t1 })).toBe("CONFLICT"); // patient already busy then
      expect(await book({})).toBe("DUPLICATE"); // same doctor, same day
      await as(reception);
      expect(await codeIn(tx, () => createAppointment(reception, { patientId: otherPatient, doctorId: FIX.doctor1, branchId: FIX.kothrud, date, time: t1, type: "in_person", reason: "ZZTEST" }, tx))).toBe("SLOT_TAKEN");

      // Slot rules the server enforces whatever the browser offers.
      expect(await book({ doctorId: FIX.doctor2, date: weekday(4), time: "13:00" })).toBe("INVALID_INPUT"); // lunch
      expect(await book({ doctorId: FIX.doctor2, date: weekday(4), time: "09:10" })).toBe("INVALID_INPUT"); // not on the grid
      expect(await book({ doctorId: FIX.doctor2, date: istDate(-1), time: "10:00" })).toBe("INVALID_INPUT"); // past
      expect(await book({ doctorId: FIX.doctor2, date: istDate(90), time: "10:00" })).toBe("INVALID_INPUT"); // too far
      expect(await book({ doctorId: FIX.doctor2, branchId: FIX.wakad, date: weekday(5), time: "10:00" })).toBe("NOT_FOUND"); // DR-02 isn't at Wakad
      expect(await book({ patientId: otherPatient })).toBe("ZodError"); // no patient id from the browser
      const offline = (await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM doctor_profiles WHERE "clinicId" = ${FIX.clinicA}::uuid AND NOT "onlineConsultation" AND status = 'ACTIVE' LIMIT 1`)[0];
      if (offline) expect(await book({ doctorId: offline.id, type: "online", date: weekday(5), time: "10:00" })).toMatch(/INVALID_INPUT|NOT_FOUND/); // online only where offered

      // Someone else's appointment: invisible and unchangeable.
      await as(reception);
      const theirs = await createAppointment(reception, { patientId: otherPatient, doctorId: FIX.doctor2, branchId: FIX.kothrud, date: weekday(6), time: "11:00", type: "in_person", reason: "ZZTEST other" }, tx);
      expect(await asPortal(() => codeIn(tx, () => getMyAppointment(portal, theirs.id, tx)))).toBe("NOT_FOUND");
      expect(await asPortal(() => codeIn(tx, () => cancelMyAppointment(portal, theirs.id, tx)))).toBe("NOT_FOUND");
      expect(await asPortal(() => codeIn(tx, () => rescheduleMyAppointment(portal, theirs.id, { date: weekday(6), time: "12:00" }, tx)))).toBe("NOT_FOUND");
      const forged: PatientContext = { ...portal, patientIds: [otherPatient] };
      expect((await asPortal(() => listMyAppointments(forged, { scope: "all", pageSize: 50 }, tx), forged)).items.map((a) => a.id)).not.toContain(theirs.id);
      // The runtime role can't write appointments directly as a patient (RLS).
      expect(await asPortal(() => codeIn(tx, () => tx.$executeRaw`UPDATE appointments SET reason = 'ZZTEST' WHERE id = ${booked.id}::uuid`))).toBe("OK");
      expect((await tx.$queryRaw<{ reason: string }[]>`SELECT reason FROM appointments WHERE id = ${booked.id}::uuid`)[0].reason).toBe("ZZTEST checkup");

      // Reschedule and cancel own; closed appointments can't be changed.
      const moved = await asPortal(() => rescheduleMyAppointment(portal, booked.id, { date, time: t3 }, tx));
      expect(moved).toMatchObject({ time: t3, status: "scheduled" });
      const cancelled = await asPortal(() => cancelMyAppointment(portal, booked.id, tx));
      expect(cancelled).toMatchObject({ status: "cancelled", canCancel: false, canReschedule: false });
      expect(await asPortal(() => codeIn(tx, () => cancelMyAppointment(portal, booked.id, tx)))).toBe("INVALID_TRANSITION");
      expect(await asPortal(() => codeIn(tx, () => rescheduleMyAppointment(portal, booked.id, { date, time: t2 }, tx)))).toBe("INVALID_TRANSITION");
      // Cancelling released the slot.
      expect((await asPortal(() => getMySlots(portal, { doctorId: FIX.doctor1, branchId: FIX.kothrud, date }, tx))).slots).toContain(t3);
      const own = await asPortal(() => listMyAppointments(portal, { scope: "cancelled" }, tx));
      expect(own.items.map((a) => a.id)).toContain(booked.id);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate, optionalContextFor } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import { createPatient, getPatient, listPatients, updatePatient } from "./patients";
import {
  createAppointment,
  getAppointment,
  getAvailableSlots,
  getTodaysAppointments,
  getWaitingRoom,
  listAppointments,
  rescheduleAppointment,
  transitionAppointment,
} from "./appointments";
import { listBranches, listDoctors, listStaff, setStaffStatus } from "./people";
import { globalSearch } from "./search";

// Front-desk data modules against the live database, as real fixture users.
// All writes run in a transaction that is rolled back (inRollback) and the
// table counts are checked afterwards, so no test data is left behind.

let admin: Client;
let adminA: TenantContext; // Aarogya administrator, clinic-wide
let adminB: TenantContext; // Nirmaya administrator
let receptionWakad: TenantContext; // Aarogya receptionist, Wakad only
let nurseKothrud: TenantContext | undefined; // Aarogya nurse, Kothrud only
let doctor1: TenantContext; // Dr. Meera Kulkarni (own_* scope)
let counts: { patients: number; appointments: number; audit: number };

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  patients: await n(`SELECT count(*) n FROM patients`),
  appointments: await n(`SELECT count(*) n FROM appointments`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-04", "DR-01"]) ctxs.push(await contextFor(admin, k)); // one pg client: sequential
  [adminA, adminB, receptionWakad, doctor1] = ctxs;
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  counts = await tableCounts();
});

afterAll(async () => {
  // Rolled-back tests must leave the database exactly as they found it.
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("patients", () => {
  it("lists the clinic's patients for staff with patient.view, matching the database", async () => {
    const page = await listPatients(adminA, { pageSize: 100 });
    expect(page.total).toBe(await n(`SELECT count(*) n FROM patients WHERE "clinicId" = $1`, [FIX.clinicA]));
    expect(page.items.every((p) => p.patientNumber?.startsWith("AAR-P-"))).toBe(true);
    const receptionist = await listPatients(receptionWakad, { pageSize: 100 });
    expect(receptionist.total).toBe(page.total); // patients are clinic-wide, even for branch staff
  });

  it("limits a doctor to patients they have appointments with", async () => {
    const page = await listPatients(doctor1, { pageSize: 100 });
    expect(page.total).toBe(await n(`SELECT count(DISTINCT "patientId") n FROM appointments WHERE "doctorId" = $1`, [FIX.doctor1]));
  });

  it("finds by patient number and never across clinics", async () => {
    const hit = await listPatients(adminA, { search: "AAR-P-0001" });
    expect(hit.items.map((p) => p.patientNumber)).toEqual(["AAR-P-0001"]);
    expect((await listPatients(adminB, { search: "AAR-P-0001" })).total).toBe(0);
    await expect(getPatient(adminB, hit.items[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getPatient(adminA, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates, persists, and edits a patient (rolled back)", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const created = await createPatient(adminA, { name: "Test Patient", age: 40, gender: "female", phone: "+91 00000 99001", branchId: FIX.kothrud }, tx);
      expect(created.patientNumber).toMatch(/^AAR-P-\d{4}$/);
      expect(created.age).toBe(40);
      // Persistence: re-read through the list and detail paths.
      expect((await getPatient(adminA, created.id, tx)).name).toBe("Test Patient");
      expect((await listPatients(adminA, { search: created.patientNumber }, tx)).items[0]?.id).toBe(created.id);
      const updated = await updatePatient(adminA, created.id, { city: "Pune", allergies: ["Penicillin"] }, tx);
      expect(updated).toMatchObject({ city: "Pune", allergies: ["Penicillin"] });
      // A second patient gets the next number (numbering is serialised per clinic).
      const second = await createPatient(adminA, { name: "Test Patient Two", age: 5, gender: "male", phone: "+91 00000 99002", branchId: FIX.kothrud }, tx);
      expect(Number(second.patientNumber!.slice(-4))).toBe(Number(created.patientNumber!.slice(-4)) + 1);
    });
  });

  it("enforces permissions and branch restrictions on patient writes", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad);
      expect(await code(createPatient(receptionWakad, { name: "Wrong Branch", age: 30, gender: "male", phone: "+91 00000 99003", branchId: FIX.kothrud }, tx))).toBe("BRANCH_FORBIDDEN");
      await as(doctor1);
      expect(await code(createPatient(doctor1, { name: "No Permission", age: 30, gender: "male", phone: "+91 00000 99004", branchId: FIX.kothrud }, tx))).toBe("FORBIDDEN");
      const anyPatient = (await listPatients(adminA, { pageSize: 1 })).items[0];
      if (nurseKothrud) {
        await as(nurseKothrud);
        expect(await code(updatePatient(nurseKothrud, anyPatient.id, { city: "X" }, tx))).toBe("FORBIDDEN");
      }
      await as(adminA);
      expect(await code(updatePatient(adminA, anyPatient.id, { clinicId: "x" }, tx))).toBe("ZodError"); // unknown fields rejected
    });
  });
});

describe("appointments", () => {
  // A clinic day (not Sunday) a few days ahead; times come from the database's own free slots.
  const day = [3, 4].map(istDate).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0)!;
  const freeSlots = async (ctx: TenantContext, doctorId: string) => {
    const slots = await getAvailableSlots(ctx, doctorId, day);
    if (slots.length < 3) throw new Error("fixture day too busy");
    return slots;
  };

  it("lists only the caller's scope: clinic, branch, or own appointments", async () => {
    const all = await listAppointments(adminA, { pageSize: 100 });
    expect(all.total).toBe(await n(`SELECT count(*) n FROM appointments WHERE "clinicId" = $1`, [FIX.clinicA]));
    const wakad = await listAppointments(receptionWakad, { pageSize: 100 });
    expect(wakad.items.every((a) => a.branchId === FIX.wakad)).toBe(true);
    expect(wakad.total).toBe(await n(`SELECT count(*) n FROM appointments WHERE "branchId" = $1`, [FIX.wakad]));
    expect(await code(listAppointments(receptionWakad, { branchId: FIX.kothrud }))).toBe("BRANCH_FORBIDDEN");
    const own = await listAppointments(doctor1, { pageSize: 100, doctorId: FIX.doctor2 }); // a doctor can't widen to another doctor
    expect(own.items.every((a) => a.doctorId === FIX.doctor1)).toBe(true);
    expect(own.items.every((a) => a.billingHidden)).toBe(true); // no billing permission → payment status not exposed
    expect((await listAppointments(adminB, { pageSize: 100 })).items.some((a) => all.items.some((b) => b.id === a.id))).toBe(false);
  });

  it("hides other doctors' appointments from a doctor", async () => {
    const other = (await listAppointments(adminA, { doctorId: FIX.doctor2, pageSize: 1 })).items[0];
    expect(await code(getAppointment(doctor1, other.id))).toBe("NOT_FOUND");
    expect(await code(transitionAppointment(doctor1, other.id, "cancel"))).toBe("NOT_FOUND");
  });

  it("books, prevents double-booking, transitions, and reschedules (rolled back)", async () => {
    const patient = (await listPatients(adminA, { search: "AAR-P-0002" })).items[0];
    const [t1, t2] = await freeSlots(adminA, FIX.doctor2);
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const appt = await createAppointment(adminA, { patientId: patient.id, doctorId: FIX.doctor2, date: day, time: t1, type: "in_person", reason: "Integration test" }, tx);
      expect(appt).toMatchObject({ status: "upcoming", date: day, time: t1, branchId: FIX.kothrud, patientName: patient.name });
      expect((await getAppointment(adminA, appt.id, tx)).reason).toBe("Integration test"); // persisted
      expect(await getAvailableSlots(adminA, FIX.doctor2, day, tx)).not.toContain(t1);
      expect(await code(createAppointment(adminA, { patientId: patient.id, doctorId: FIX.doctor2, date: day, time: t1, type: "in_person", reason: "Clash" }, tx))).toBe("SLOT_TAKEN");

      const checkedIn = await transitionAppointment(adminA, appt.id, "check-in", tx);
      expect(checkedIn.status).toBe("waiting");
      expect(checkedIn.checkedInAt).toBeTruthy();
      expect(await code(transitionAppointment(adminA, appt.id, "check-in", tx))).toBe("INVALID_TRANSITION");
      const moved = await rescheduleAppointment(adminA, appt.id, { date: day, time: t2 }, tx);
      expect(moved).toMatchObject({ status: "upcoming", time: t2 });
      expect(await getAvailableSlots(adminA, FIX.doctor2, day, tx)).toContain(t1); // the old slot is released
      expect((await transitionAppointment(adminA, appt.id, "cancel", tx)).status).toBe("cancelled");
      expect(await getAvailableSlots(adminA, FIX.doctor2, day, tx)).toContain(t2); // a cancelled slot is free again
    });
  });

  it("blocks cross-branch double-booking of a doctor who works at two branches (rolled back)", async () => {
    const patient = (await listPatients(adminA, { search: "AAR-P-0003" })).items[0];
    const [t1, t2] = await freeSlots(adminA, FIX.doctor1);
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      await createAppointment(adminA, { patientId: patient.id, doctorId: FIX.doctor1, branchId: FIX.kothrud, date: day, time: t1, type: "in_person", reason: "At Kothrud" }, tx);
      await as(receptionWakad); // can't see the Kothrud booking…
      expect((await listAppointments(receptionWakad, { date: day, pageSize: 100 }, tx)).items.some((a) => a.time === t1 && a.doctorId === FIX.doctor1)).toBe(false);
      // …but still can't double-book the doctor at that time.
      expect(await getAvailableSlots(receptionWakad, FIX.doctor1, day, tx)).not.toContain(t1);
      expect(await code(createAppointment(receptionWakad, { patientId: patient.id, doctorId: FIX.doctor1, date: day, time: t1, type: "in_person", reason: "At Wakad" }, tx))).toBe("SLOT_TAKEN");
      // A doctor who doesn't work at the receptionist's branch can't be booked there.
      expect(await code(createAppointment(receptionWakad, { patientId: patient.id, doctorId: FIX.doctor2, branchId: FIX.wakad, date: day, time: t2, type: "in_person", reason: "Wrong branch" }, tx))).toBe("INVALID_INPUT");
    });
  });

  it("rejects past bookings, other clinics' patients, and doctors booking for others", async () => {
    const patientA = (await listPatients(adminA, { pageSize: 1 })).items[0];
    const patientB = (await listPatients(adminB, { pageSize: 1 })).items[0];
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await code(createAppointment(adminA, { patientId: patientA.id, doctorId: FIX.doctor2, date: istDate(-1), time: "10:00", type: "in_person", reason: "Past" }, tx))).toBe("INVALID_INPUT");
      expect(await code(createAppointment(adminA, { patientId: patientB.id, doctorId: FIX.doctor2, date: day, time: "16:00", type: "in_person", reason: "Other clinic" }, tx))).toBe("INVALID_INPUT"); // patient check precedes the slot check
      await as(doctor1);
      expect(await code(createAppointment(doctor1, { patientId: patientA.id, doctorId: FIX.doctor1, date: day, time: "16:30", type: "in_person", reason: "Not allowed" }, tx))).toBe("FORBIDDEN");
    });
  });

  it("serves today's schedule and the waiting room without error", async () => {
    const today = await getTodaysAppointments(adminA, undefined);
    expect(today.every((a) => a.date === istDate(0))).toBe(true);
    const waiting = await getWaitingRoom(adminA, undefined);
    expect(waiting.every((a) => ["waiting", "in_consultation"].includes(a.status))).toBe(true);
  });
});

describe("doctors, staff, branches, search", () => {
  it("lists the clinic's doctors and branches only", async () => {
    const doctors = await listDoctors(adminA, { pageSize: 50 });
    expect(doctors.total).toBe(await n(`SELECT count(*) n FROM doctor_profiles WHERE "clinicId" = $1`, [FIX.clinicA]));
    expect(doctors.items.every((d) => d.clinicId === FIX.clinicA && d.rating === null)).toBe(true);
    expect((await listBranches(adminA)).map((b) => b.id).sort()).toEqual([FIX.kothrud, FIX.wakad].sort());
    expect((await listBranches(receptionWakad)).map((b) => b.id)).toEqual([FIX.wakad]);
  });

  it("restricts the staff directory and status changes", async () => {
    const staff = await listStaff(adminA, { pageSize: 50 });
    expect(staff.items.length).toBeGreaterThan(0);
    expect(staff.items.every((s) => s.clinicId === FIX.clinicA)).toBe(true);
    expect(await code(listStaff(receptionWakad, {}))).toBe("FORBIDDEN");
    const self = staff.items.find((s) => s.name === adminA.name)!;
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await code(setStaffStatus(adminA, self.id, { status: "inactive" }, tx))).toBe("CONFLICT");
      const nurse = staff.items.find((s) => s.role === "nurse")!;
      expect(await setStaffStatus(adminA, nurse.id, { status: "inactive" }, tx)).toEqual({ id: nurse.id, status: "inactive" });
    });
  });

  it("searches within the caller's clinic and permissions", async () => {
    const a = await globalSearch(adminA, "AAR-P-0001");
    expect(a.patients).toHaveLength(1);
    expect((await globalSearch(adminB, "AAR-P-0001")).patients).toHaveLength(0);
    expect((await globalSearch(adminA, "Kulkarni")).doctors.map((d) => d.title)).toContain("Dr. Meera Kulkarni");
  });
});

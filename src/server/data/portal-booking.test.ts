import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PatientContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";

// The portal booking data module WITHOUT a database: a fake transaction records
// every query, so this checks that each read carries the patient's own filter,
// that writes go only through the patient_* database functions (with no patient
// id from the request), and that booking + symptoms share one transaction.
// Database behaviour (RLS, locks, conflicts): portal-booking.integration.test.ts.

vi.mock("server-only", () => ({}));
// Every call below passes its own fake transaction; a real connection must never be opened.
vi.mock("@/server/db/tenant", () => ({
  withPatientDb: () => {
    throw new Error("no database in unit tests");
  },
  withTenantDb: () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("./documents", () => ({
  lookupNames: async () => ({ branch: new Map([["b1", { id: "b1", name: "Kothrud" }]]), doctor: new Map([["d1", { id: "d1", name: "Dr. Asha" }]]), patient: new Map(), user: new Map() }),
}));
const intake = vi.hoisted(() => ({ submit: vi.fn(async () => ({ created: true, appointmentLinked: true })) }));
vi.mock("./patient-intake", () => ({ submitSymptomReport: intake.submit }));

const { bookMyAppointment, cancelMyAppointment, getMyAppointment, listMyAppointments } = await import("./portal-booking");

const ctx: PatientContext = { authUserId: "a", userId: "u", email: "p@example.test", name: "P", clinicId: "c1", clinicName: "Aarogya", patientIds: ["pt-1"] };
const APPT = "33333333-3333-4333-8333-333333333333";
const row = (over: Record<string, unknown> = {}) => ({
  id: APPT, branchId: "b1", doctorId: "d1", startsAt: new Date("2026-10-21T04:30:00.000Z"), durationMinutes: 30, type: "IN_PERSON", status: "SCHEDULED", reason: "Fever", ...over,
});

function fakeTx(found: unknown = row()) {
  const calls: { op: string; arg: unknown }[] = [];
  const sql: string[] = [];
  const tx = {
    appointment: {
      findMany: vi.fn(async (arg: unknown) => (calls.push({ op: "findMany", arg }), [row()])),
      count: vi.fn(async (arg: unknown) => (calls.push({ op: "count", arg }), 1)),
      findFirst: vi.fn(async (arg: unknown) => (calls.push({ op: "findFirst", arg }), found)),
    },
    doctorProfile: { findMany: vi.fn(async () => [{ id: "d1", specialty: { name: "General Medicine" } }]) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => (sql.push(strings.join("?")), values.length >= 0 ? [{ id: APPT }] : [])),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => (sql.push(strings.join("?")), 1)),
  };
  return { tx: tx as unknown as TenantTx, calls, sql, raw: tx };
}

const NOW = new Date("2026-10-20T04:00:00.000Z");

beforeEach(() => vi.clearAllMocks());

describe("portal booking data module", () => {
  it("lists only the patient's own appointments in their clinic", async () => {
    const { tx, calls } = fakeTx();
    const page = await listMyAppointments(ctx, { scope: "upcoming" }, tx, NOW);
    for (const c of calls) expect(c.arg, c.op).toMatchObject({ where: { clinicId: "c1", patientId: { in: ["pt-1"] } } });
    expect(page.items[0]).toMatchObject({ id: APPT, reference: "33333333", date: "2026-10-21", time: "10:00", status: "scheduled", doctorName: "Dr. Asha", specialty: "General Medicine", branchName: "Kothrud", canCancel: true });
  });

  it("someone else's (or an unknown) appointment is a 404, never a different error", async () => {
    const { tx } = fakeTx(null);
    await expect(getMyAppointment(ctx, APPT, tx, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelMyAppointment(ctx, APPT, tx, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getMyAppointment(ctx, "not-a-uuid", tx, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("books through app.patient_book_appointment and saves symptoms in the same transaction", async () => {
    const { tx, sql } = fakeTx();
    const input = {
      branchId: "11111111-1111-4111-8111-111111111111", doctorId: "22222222-2222-4222-8222-222222222222", date: "2026-10-21", time: "10:00", reason: "Fever",
      symptoms: { requestId: "44444444-4444-4444-8444-444444444444", symptoms: "Cough", onset: "TODAY", severity: null },
    };
    const booked = await bookMyAppointment(ctx, input, tx, NOW);
    expect(sql[0]).toMatch(/app\.patient_book_appointment\(\?::uuid, \?::uuid, \?, \?, \?\)/);
    expect(intake.submit).toHaveBeenCalledWith(ctx, expect.objectContaining({ appointmentId: APPT, reason: "Fever", symptoms: "Cough", onset: "TODAY" }), tx);
    expect(booked.id).toBe(APPT);
  });

  it("refusals from the database become API errors (and nothing else is written)", async () => {
    const { tx, raw } = fakeTx();
    raw.$queryRaw.mockRejectedValueOnce(new Error("patient booking: SLOT_TAKEN"));
    await expect(
      bookMyAppointment(ctx, { branchId: "11111111-1111-4111-8111-111111111111", doctorId: "22222222-2222-4222-8222-222222222222", date: "2026-10-21", time: "10:00", reason: "Fever" }, tx, NOW)
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    expect(intake.submit).not.toHaveBeenCalled();
    raw.$executeRaw.mockRejectedValueOnce(new Error("patient booking: NOT_CHANGEABLE"));
    await expect(cancelMyAppointment(ctx, APPT, tx, NOW)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("a closed or started appointment offers no actions", async () => {
    const { tx } = fakeTx(row({ status: "COMPLETED" }));
    expect(await getMyAppointment(ctx, APPT, tx, NOW)).toMatchObject({ status: "completed", canCancel: false, canReschedule: false });
    const started = fakeTx(row({ startsAt: new Date(NOW.getTime() - 60_000) }));
    expect(await getMyAppointment(ctx, APPT, started.tx, NOW)).toMatchObject({ canCancel: false, canReschedule: false });
  });
});

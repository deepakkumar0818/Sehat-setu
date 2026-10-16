import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";

// Reception's booking-request queue and decisions WITHOUT a database: a fake
// transaction records each query. Checks the permission gate, that decisions go
// only through the database review functions (with nothing but the appointment
// id from the request), that database refusals become clear messages, and that
// staff schedules, counts and the patient portal treat requests correctly.
// Database behaviour (guard trigger, RLS, slot lock, grants) was verified by
// running every migration on a throwaway PostgreSQL; see docs/security.md.

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/tenant", () => ({
  withTenantDb: () => {
    throw new Error("no database in unit tests");
  },
  withPatientDb: () => {
    throw new Error("no database in unit tests");
  },
}));

const { approveBookingRequest, listBookingRequests, rejectBookingRequest } = await import("./booking-review");
const { listAppointments, getTodaysAppointments } = await import("./appointments");
const { patientCanChange, scopeFilter } = await import("./portal-booking-rules");

const APPT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-20T04:00:00.000Z");
const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  authUserId: "a", userId: "u1", email: "r@example.test", name: "Reception", clinicId: "c1", clinicName: "Aarogya", branchId: null,
  roles: ["RECEPTIONIST"], permissions: new Set(["appointment.update", "appointment.view"]), doctorId: null, careScope: "clinic", ...over,
});
const req = (over: Record<string, unknown> = {}) => ({
  id: APPT, branchId: "b1", patientId: "p1", doctorId: "d1", startsAt: new Date("2026-10-21T04:30:00.000Z"), durationMinutes: 30, type: "IN_PERSON",
  reason: "Fever", createdAt: NOW, updatedAt: NOW, patient: { name: "Asha", patientNumber: "AAR-P-0001" }, branch: { name: "Kothrud" },
  doctor: { user: { name: "Dr. Rao" }, specialty: { name: "General" } }, _count: { symptomReports: 1 }, onlineOrders: [], ...over,
});

function fakeTx(opts: { rows?: unknown[]; fail?: string } = {}) {
  const calls: { op: string; arg: unknown }[] = [];
  const sql: { text: string; values: unknown[] }[] = [];
  const tx = {
    appointment: {
      findMany: vi.fn(async (arg: unknown) => (calls.push({ op: "findMany", arg }), opts.rows ?? [req()])),
      count: vi.fn(async (arg: unknown) => (calls.push({ op: "count", arg }), (opts.rows ?? [req()]).length)),
      findFirst: vi.fn(async () => ({ id: APPT, status: "CONFIRMED", approvedAt: NOW, rejectedAt: null, rejectionReason: null })),
    },
    patient: { findMany: vi.fn(async () => []) },
    doctorProfile: { findMany: vi.fn(async () => []) },
    invoice: { findMany: vi.fn(async () => []) },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push({ text: strings.join("?"), values });
      if (opts.fail) throw new Error(`Raw query failed. Message: \`${opts.fail}\``);
      return 1;
    }),
  };
  return { tx: tx as unknown as TenantTx, calls, sql };
}

beforeEach(() => vi.clearAllMocks());

describe("booking request queue", () => {
  it("lists only pending requests of the caller's clinic, with what reception needs; expired ones last", async () => {
    const { tx, calls } = fakeTx({ rows: [req({ id: "x-old", startsAt: new Date("2026-10-19T04:30:00.000Z") }), req()] });
    const page = await listBookingRequests(ctx(), {}, tx, NOW);
    expect(calls[0].arg).toMatchObject({ where: { clinicId: "c1", status: "PENDING_APPROVAL" } });
    expect(page.items.map((i) => i.id)).toEqual([APPT, "x-old"]);
    expect(page.items[0]).toMatchObject({ patientName: "Asha", patientNumber: "AAR-P-0001", doctorName: "Dr. Rao", branchName: "Kothrud", date: "2026-10-21", time: "10:00", reason: "Fever", hasSymptomReport: true, expired: false });
    expect(page.items[1].expired).toBe(true);
    expect(page.items[0].feePaid).toBeNull();
    const paid = await listBookingRequests(ctx(), {}, fakeTx({ rows: [req({ onlineOrders: [{ amountPaise: 50000 }] })] }).tx, NOW);
    expect(paid.items[0].feePaid).toBe(500);
  });

  it("a branch-restricted receptionist sees only their branch and can't ask for another", async () => {
    const { tx, calls } = fakeTx();
    await listBookingRequests(ctx({ branchId: "b1" }), {}, tx, NOW);
    expect(calls[0].arg).toMatchObject({ where: { branchId: "b1" } });
    await expect(listBookingRequests(ctx({ branchId: "b1" }), { branchId: "6f1c1f9e-2b9b-4a63-9d7e-0d1f0b8f2a11" }, tx, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("roles without appointment.update can't list or decide (doctor, nurse)", async () => {
    const { tx, sql } = fakeTx();
    for (const permissions of [new Set(["own_appointments.view", "own_appointments.manage"]), new Set(["appointment.view"])]) {
      const c = ctx({ permissions });
      await expect(listBookingRequests(c, {}, tx, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(approveBookingRequest(c, APPT, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(rejectBookingRequest(c, APPT, { reason: "No slot" }, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(sql).toEqual([]);
  });
});

describe("approve / reject", () => {
  it("approve calls only the database function, with only the appointment id", async () => {
    const { tx, sql } = fakeTx();
    const res = await approveBookingRequest(ctx(), APPT, tx);
    expect(sql).toEqual([{ text: "SELECT app.approve_patient_booking(?::uuid)", values: [APPT] }]);
    expect(res).toMatchObject({ id: APPT, status: "confirmed" });
  });

  it("reject needs a reason and passes it trimmed; nothing else from the request", async () => {
    const { tx, sql } = fakeTx();
    await expect(rejectBookingRequest(ctx(), APPT, { reason: " x " }, tx)).rejects.toThrow();
    await expect(rejectBookingRequest(ctx(), APPT, { reason: "On leave", status: "CONFIRMED" }, tx)).rejects.toThrow(); // strict body
    await rejectBookingRequest(ctx(), APPT, { reason: "  Doctor on leave  " }, tx);
    expect(sql).toEqual([{ text: "SELECT app.reject_patient_booking(?::uuid, ?)", values: [APPT, "Doctor on leave"] }]);
  });

  it("malformed ids are not found, without reaching the database", async () => {
    const { tx, sql } = fakeTx();
    await expect(approveBookingRequest(ctx(), "1 OR 1=1", tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sql).toEqual([]);
  });

  it.each([
    ["booking review: SLOT_TAKEN", "SLOT_TAKEN", /already taken/],
    ["booking review: EXPIRED", "EXPIRED", /already passed/],
    ["booking review: NOT_PENDING", "INVALID_TRANSITION", /already handled/],
    ["booking review: UNAVAILABLE", "CONFLICT", /no longer active/],
    ["booking review: PATIENT_CONFLICT", "CONFLICT", /another appointment/],
    ["booking review: NOT_FOUND", "NOT_FOUND", /./],
    ["booking review: NOT_PERMITTED", "FORBIDDEN", /./],
  ])("database refusal %s → %s with a clear message", async (fail, code, message) => {
    const { tx } = fakeTx({ fail });
    await expect(approveBookingRequest(ctx(), APPT, tx)).rejects.toMatchObject({ code, message: expect.stringMatching(message) });
  });
});

describe("schedules and the portal treat requests correctly", () => {
  it("staff lists and today's schedule exclude pending/declined requests unless asked for by status", async () => {
    const { tx, calls } = fakeTx({ rows: [] });
    await listAppointments(ctx(), {}, tx);
    await listAppointments(ctx(), { status: "all" }, tx);
    await getTodaysAppointments(ctx(), undefined, tx, NOW);
    for (const c of calls) expect(c.arg, c.op).toMatchObject({ where: { status: { notIn: ["PENDING_APPROVAL", "REJECTED"] } } });
    calls.length = 0;
    await listAppointments(ctx(), { status: "rejected" }, tx);
    expect(calls[0].arg).toMatchObject({ where: { status: { in: ["REJECTED"] } } });
    calls.length = 0;
    await listAppointments(ctx(), { status: "upcoming" }, tx);
    expect(calls[0].arg).toMatchObject({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] } } });
  });

  it("a doctor's own schedule never includes requests either", async () => {
    const { tx, calls } = fakeTx({ rows: [] });
    await listAppointments(ctx({ permissions: new Set(["own_appointments.view"]), careScope: "own", doctorId: "d1" }), {}, tx);
    expect(calls[0].arg).toMatchObject({ where: { doctorId: "d1", status: { notIn: ["PENDING_APPROVAL", "REJECTED"] } } });
  });

  it("patients may withdraw or move a pending request before it starts; declined ones are listed with cancelled", () => {
    const later = new Date(NOW.getTime() + 3600_000);
    expect(patientCanChange("PENDING_APPROVAL", later, NOW)).toBe(true);
    expect(patientCanChange("PENDING_APPROVAL", new Date(NOW.getTime() - 1000), NOW)).toBe(false);
    expect(patientCanChange("REJECTED", later, NOW)).toBe(false);
    expect(scopeFilter("cancelled", NOW)).toEqual({ status: { in: ["CANCELLED", "REJECTED"] } });
    expect(JSON.stringify(scopeFilter("upcoming", NOW))).toContain("PENDING_APPROVAL");
  });
});

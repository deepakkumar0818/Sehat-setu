import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import type { PatientContext } from "@/server/auth/authorize";

// Portal booking routes WITHOUT a database: the patient session and the data
// functions are stubbed, so this checks the HTTP contract — only a signed-in,
// linked patient gets in; the patient comes from the session, never the
// request; refusals keep their status codes. Database behaviour:
// src/server/data/portal-booking.integration.test.ts.

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ next: null as null | (() => Promise<PatientContext>) }));
vi.mock("@/server/auth/session", () => ({
  requirePatient: async () => {
    if (!session.next) throw new AuthError("UNAUTHENTICATED");
    return session.next();
  },
  requireStaff: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
  requireIdentity: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
}));
const data = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })),
  book: vi.fn(async () => ({ id: "appt" })),
  get: vi.fn(),
  cancel: vi.fn(async () => ({ id: "appt", status: "cancelled" })),
  reschedule: vi.fn(async () => ({ id: "appt" })),
  slots: vi.fn(async () => ({ date: "2026-10-21", slots: ["10:00"] })),
  dashboard: vi.fn(async () => ({ upcoming: [] })),
}));
vi.mock("@/server/data/portal-booking", () => ({
  listMyAppointments: data.list,
  bookMyAppointment: data.book,
  getMyAppointment: data.get,
  cancelMyAppointment: data.cancel,
  rescheduleMyAppointment: data.reschedule,
  getMySlots: data.slots,
  getPortalDashboard: data.dashboard,
  getBookingOptions: async () => ({ branches: [], doctors: [] }),
  listMyInvoices: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  getMyClinicRecord: async () => ({ name: "P" }),
}));

const appointments = await import("./appointments/route");
const one = await import("./appointments/[id]/route");
const cancel = await import("./appointments/[id]/cancel/route");
const reschedule = await import("./appointments/[id]/reschedule/route");
const slots = await import("./slots/route");
const dashboard = await import("./dashboard/route");

const patient: PatientContext = { authUserId: "a", userId: "u", email: "p@example.test", name: "P", clinicId: "c", clinicName: "C", patientIds: ["pt-1"] };
const ID = "33333333-3333-4333-8333-333333333333";
const req = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/portal/${path}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = <P,>(p: P) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  session.next = async () => patient;
});

describe("/api/v1/portal booking routes", () => {
  it("401 without a session and 403 for a login without a patient link, on every route — JSON, no data call", async () => {
    for (const ctxFn of [null, async () => { throw new AuthError("PATIENT_NOT_LINKED"); }]) {
      session.next = ctxFn as typeof session.next;
      const results = [
        await appointments.GET(req("appointments"), params({})),
        await appointments.POST(req("appointments", {}), params({})),
        await cancel.POST(req(`appointments/${ID}/cancel`, {}), params({ id: ID })),
        await slots.GET(req("slots"), params({})),
        await dashboard.GET(req("dashboard"), params({})),
      ];
      for (const r of results) {
        expect([401, 403]).toContain(r.status);
        expect(await r.json()).toHaveProperty("error");
      }
    }
    expect(data.list).not.toHaveBeenCalled();
    expect(data.book).not.toHaveBeenCalled();
    expect(data.cancel).not.toHaveBeenCalled();
  });

  it("books for the session's patient: the body is passed through untouched for validation, and the context comes from the session", async () => {
    const body = { branchId: "b", doctorId: "d", date: "2026-10-21", time: "10:00", reason: "Fever", patientId: "someone-else" };
    const res = await appointments.POST(req("appointments", body), params({}));
    expect(res.status).toBe(200);
    expect(data.book).toHaveBeenCalledWith(patient, body);
    // (bookingSchema is strict, so the data module rejects the extra patientId — see portal-booking-rules.test.ts.)
  });

  it("lists, cancels and reschedules by the URL id only; another patient's appointment is a 404", async () => {
    await appointments.GET(req("appointments?scope=past&page=2"), params({}));
    expect(data.list).toHaveBeenCalledWith(patient, { scope: "past", page: "2" });
    data.get.mockRejectedValueOnce(new AuthError("NOT_FOUND"));
    const res = await one.GET(req(`appointments/${ID}`), params({ id: ID }));
    expect(res.status).toBe(404);
    await cancel.POST(req(`appointments/${ID}/cancel`, {}), params({ id: ID }));
    expect(data.cancel).toHaveBeenCalledWith(patient, ID);
    await reschedule.POST(req(`appointments/${ID}/reschedule`, { date: "2026-10-22", time: "11:00" }), params({ id: ID }));
    expect(data.reschedule).toHaveBeenCalledWith(patient, ID, { date: "2026-10-22", time: "11:00" });
  });

  it("keeps booking refusals' status codes (taken slot 409, not changeable 409, bad input 400)", async () => {
    data.book.mockRejectedValueOnce(new DataError("SLOT_TAKEN", "Sorry, that slot was just booked."));
    let res = await appointments.POST(req("appointments", {}), params({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "SLOT_TAKEN" });
    data.cancel.mockRejectedValueOnce(new DataError("INVALID_TRANSITION", "This appointment can no longer be changed online."));
    res = await cancel.POST(req(`appointments/${ID}/cancel`, {}), params({ id: ID }));
    expect(res.status).toBe(409);
    data.book.mockRejectedValueOnce(new DataError("INVALID_INPUT", "Choose a valid date and time."));
    res = await appointments.POST(req("appointments", {}), params({}));
    expect(res.status).toBe(400);
  });
});

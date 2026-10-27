import { describe, expect, it } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import {
  appointmentReference,
  bookableSlots,
  bookingSchema,
  isMissingBookingSchema,
  mapBookingDbError,
  patientCanChange,
  rescheduleSchema,
  scopeFilter,
} from "./portal-booking-rules";
import { istToInstant } from "./mappers";
import { DEFAULT_SETTINGS } from "./clinic-settings-rules";

// Pure booking rules (mirroring app.patient_* in migration 20261028000000):
// what slots a patient is offered, what they may change, what the browser may
// send, and how database refusals become API errors.

const NOW = istToInstant("2026-10-20", "10:05"); // a Tuesday, 10:05 IST
const BRANCH = "11111111-1111-4111-8111-111111111111";
const DOCTOR = "22222222-2222-4222-8222-222222222222";

describe("bookableSlots", () => {
  const S = DEFAULT_SETTINGS;
  const busy = (date: string, from: string, minutes: number) => ({ start: istToInstant(date, from), end: new Date(istToInstant(date, from).getTime() + minutes * 60_000) });

  it("offers the clinic's standard grid by default (no lunch, no Sundays)", () => {
    const slots = bookableSlots("2026-10-21", [], NOW, S);
    expect(slots[0]).toBe("09:00");
    expect(slots.at(-1)).toBe("16:30");
    expect(slots).not.toContain("13:00");
    expect(slots).not.toContain("13:30");
    expect(slots).toHaveLength(14);
    expect(bookableSlots("2026-10-25", [], NOW, S)).toEqual([]); // Sunday
  });

  it("hides booked time and anything sooner than the notice or beyond the booking window", () => {
    const today = bookableSlots("2026-10-20", [busy("2026-10-20", "11:00", 30)], NOW, S);
    // 10:05 + 30 min = 10:35: 10:30 is too soon, 11:00 is taken → first offer 11:30.
    expect(today[0]).toBe("11:30");
    expect(today).not.toContain("10:30");
    expect(today).not.toContain("11:00");
    const far = new Date(NOW.getTime() + (S.bookingMaxDaysAhead + 2) * 864e5).toISOString().slice(0, 10);
    expect(bookableSlots(far, [], NOW, S)).toEqual([]);
    expect(bookableSlots("2026-10-21", [], NOW, { ...S, bookingMaxDaysAhead: 0 })).toEqual([]);
  });

  it("follows the clinic's timings and checks overlaps, not just equal start times", () => {
    const custom = { ...S, slotMinutes: 20 as const, breakStart: null, breakEnd: null, weeklyHours: { ...S.weeklyHours, wed: { open: "10:00", close: "12:00" } } };
    // A 30-minute visit booked at 10:00 (before the change) blocks 10:00 and 10:20.
    expect(bookableSlots("2026-10-21", [busy("2026-10-21", "10:00", 30)], NOW, custom)).toEqual(["10:40", "11:00", "11:20", "11:40"]);
    expect(bookableSlots("2026-10-21", [], NOW, { ...custom, onlineBookingEnabled: false })).toEqual([]);
    expect(bookableSlots("2026-10-20", [], NOW, { ...S, bookingMinNoticeMinutes: 2880 })).toEqual([]);
  });
});

describe("patientCanChange (cancel / reschedule)", () => {
  const later = new Date(NOW.getTime() + 3600_000);
  it("only appointments that haven't started and aren't closed", () => {
    expect(patientCanChange("SCHEDULED", later, NOW)).toBe(true);
    expect(patientCanChange("CONFIRMED", later, NOW)).toBe(true);
    for (const s of ["CHECKED_IN", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW", "REJECTED"] as const) expect(patientCanChange(s, later, NOW), s).toBe(false);
    expect(patientCanChange("SCHEDULED", new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });
});

describe("what the browser may send", () => {
  const valid = { branchId: BRANCH, doctorId: DOCTOR, date: "2026-10-21", time: "10:00", reason: "Fever" };
  it("accepts a booking without any patient or clinic id, and rejects extra fields", () => {
    expect(bookingSchema.parse(valid)).toMatchObject({ ...valid, type: "in_person" }); // in person unless asked
    expect(bookingSchema.parse({ ...valid, type: "online" }).type).toBe("online");
    expect(bookingSchema.safeParse({ ...valid, type: "walk_in" }).success).toBe(false); // patients can't pick staff-only types
    for (const extra of [{ patientId: DOCTOR }, { clinicId: BRANCH }, { status: "CONFIRMED" }]) {
      expect(bookingSchema.safeParse({ ...valid, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(bookingSchema.safeParse({ ...valid, reason: "x" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...valid, doctorId: "not-a-uuid" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...valid, symptoms: { requestId: DOCTOR, symptoms: "Cough", onset: "TODAY", severity: "MILD" } }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...valid, symptoms: { requestId: DOCTOR, symptoms: "Cough" } }).success).toBe(false); // onset required
    expect(rescheduleSchema.safeParse({ date: "2026-10-21", time: "10:00", doctorId: DOCTOR }).success).toBe(false); // can't switch doctor
  });
});

describe("mapBookingDbError", () => {
  const code = (msg: string) => {
    try {
      mapBookingDbError(new Error(msg));
    } catch (e) {
      return e instanceof DataError || e instanceof AuthError ? e.code : "RETHROWN";
    }
  };
  it("turns each refusal into the API error the UI understands", () => {
    expect(code("patient booking: SLOT_TAKEN")).toBe("SLOT_TAKEN");
    expect(code("patient booking: PATIENT_CONFLICT")).toBe("CONFLICT");
    expect(code("patient booking: DUPLICATE")).toBe("DUPLICATE");
    expect(code("patient booking: LIMIT")).toBe("RATE_LIMITED");
    expect(code("patient booking: TOO_SOON")).toBe("INVALID_INPUT");
    expect(code("patient booking: INVALID_SLOT")).toBe("INVALID_INPUT");
    expect(code("patient booking: NOT_CHANGEABLE")).toBe("INVALID_TRANSITION");
    expect(code("patient booking: ONLINE_UNAVAILABLE")).toBe("INVALID_INPUT");
    expect(code("patient booking: CLOSED")).toBe("FEATURE_UNAVAILABLE");
    // Another patient's appointment and an unknown one look the same.
    expect(code("patient booking: NOT_FOUND")).toBe("NOT_FOUND");
    expect(code("patient booking: NOT_PERMITTED")).toBe("FORBIDDEN");
    expect(code("connection reset")).toBe("RETHROWN");
  });

  it("reports a missing migration as 'not available yet'", () => {
    const err = new Error("function app.patient_book_appointment(uuid, uuid, timestamp with time zone, text) does not exist");
    expect(isMissingBookingSchema(err)).toBe(true);
    expect(code(err.message)).toBe("FEATURE_UNAVAILABLE");
  });
});

describe("list scopes and references", () => {
  it("upcoming keeps today's unfinished visit; cancelled is its own tab", () => {
    expect(scopeFilter("upcoming", NOW)).toMatchObject({ status: { in: ["PENDING_APPROVAL", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION"] } });
    expect(scopeFilter("cancelled", NOW)).toEqual({ status: { in: ["CANCELLED", "REJECTED"] } }); // declined requests too
    expect(scopeFilter("all", NOW)).toEqual({});
    expect(appointmentReference("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).toBe("A1B2C3D4");
  });
});

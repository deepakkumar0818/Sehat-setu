// Pure rules for patient self-booking, shared by the data module and its tests.
// The database functions in migration 20261028000000_patient_self_booking are
// the authority (they re-check the caller, the slot, the doctor and the
// limits); these give early validation, compute what to offer, and turn the
// functions' 'patient booking: <CODE>' refusals into API errors.
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { istToInstant, defaultSlotsFor, type DbAppointmentStatus } from "./mappers";
import { errorText } from "./document-rules";
import type { PortalAppointmentScope, PortalAppointmentStatus } from "@/lib/live-types";

/** Same as app.patient_check_new_slot. */
export const MIN_LEAD_MINUTES = 30;
export const MAX_DAYS_AHEAD = 60;
export const MAX_UPCOMING = 5;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time.");
const uuid = (msg: string) => z.string().uuid(msg);

/** Optional pre-visit symptoms, sent with the booking (stored as a patient-reported symptom report). */
export const bookingSymptomsSchema = z
  .object({
    requestId: z.string().uuid(),
    symptoms: z.string().trim().min(2, "Describe your symptoms.").max(2000),
    onset: z.enum(["TODAY", "DAYS_1_3", "DAYS_4_7", "WEEKS_1_4", "OVER_1_MONTH", "UNSURE"], { errorMap: () => ({ message: "Choose when your symptoms started." }) }),
    severity: z.enum(["MILD", "MODERATE", "SEVERE"]).nullable().optional(),
  })
  .strict();

/** What the browser may send to book: no patient id, no clinic id, no status. */
export const bookingSchema = z
  .object({
    branchId: uuid("Choose a branch."),
    doctorId: uuid("Choose a doctor."),
    date: isoDate,
    time: hhmm,
    reason: z.string().trim().min(2, "Tell us the reason for your visit.").max(300),
    /** In person at the branch, or online (only with a doctor who offers it — the database re-checks). */
    type: z.enum(["in_person", "online"]).default("in_person"),
    symptoms: bookingSymptomsSchema.nullable().optional(),
  })
  .strict();
export type BookingInput = z.infer<typeof bookingSchema>;

export const rescheduleSchema = z.object({ date: isoDate, time: hhmm }).strict();

export const slotsQuerySchema = z.object({ doctorId: uuid("Choose a doctor."), branchId: uuid("Choose a branch."), date: isoDate });

export const appointmentsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past", "cancelled", "all"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

/** Parses an IST date + time, or a 400. */
export function slotInstant(date: string, time: string): Date {
  try {
    return istToInstant(date, time);
  } catch {
    throw new DataError("INVALID_INPUT", "Choose a valid date and time.");
  }
}

/** The clinic's standard slots for a date that a patient may still book (lead time and window applied). */
export function bookableSlots(date: string, busy: ReadonlySet<string>, now: Date): string[] {
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const latest = now.getTime() + MAX_DAYS_AHEAD * 864e5;
  return defaultSlotsFor(date).filter((t) => {
    if (busy.has(t)) return false;
    const at = istToInstant(date, t).getTime();
    return at >= earliest && at <= latest;
  });
}

/** Mirrors app.patient_cancel/reschedule_appointment: pending requests and confirmed visits that haven't started. */
export function patientCanChange(status: DbAppointmentStatus, startsAt: Date, now: Date): boolean {
  return (status === "PENDING_APPROVAL" || status === "SCHEDULED" || status === "CONFIRMED") && startsAt.getTime() > now.getTime();
}

export const portalStatus = (s: DbAppointmentStatus) => s.toLowerCase() as PortalAppointmentStatus;

// A pending request is listed with the patient's upcoming visits (labelled as awaiting approval); one whose time passed moves to "past".
const ACTIVE: DbAppointmentStatus[] = ["PENDING_APPROVAL", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION"];

/** Which rows a list scope covers (the patient filter is added separately). */
export function scopeFilter(scope: PortalAppointmentScope, now: Date) {
  switch (scope) {
    case "upcoming":
      // Today's visit stays "upcoming" until it's finished, even after its start time.
      return { status: { in: ACTIVE }, startsAt: { gte: new Date(now.getTime() - 12 * 3600_000) } };
    case "past":
      return { OR: [{ status: { in: ["COMPLETED", "NO_SHOW"] as DbAppointmentStatus[] } }, { status: { in: ACTIVE }, startsAt: { lt: new Date(now.getTime() - 12 * 3600_000) } }] };
    case "cancelled":
      // Cancelled visits and declined requests.
      return { status: { in: ["CANCELLED", "REJECTED"] as DbAppointmentStatus[] } };
    default:
      return {};
  }
}

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  INVALID_INPUT: ["INVALID_INPUT", "Please check the booking details and try again."],
  INVALID_SLOT: ["INVALID_INPUT", "That time isn't one of the clinic's appointment slots. Choose another."],
  TOO_SOON: ["INVALID_INPUT", `Appointments must be booked at least ${MIN_LEAD_MINUTES} minutes ahead. Choose a later slot.`],
  TOO_FAR: ["INVALID_INPUT", `Appointments can be booked up to ${MAX_DAYS_AHEAD} days ahead.`],
  SLOT_TAKEN: ["SLOT_TAKEN", "Sorry, that slot was just booked. Please choose another time."],
  PATIENT_CONFLICT: ["CONFLICT", "You already have an appointment at that time."],
  DUPLICATE: ["DUPLICATE", "You already have an appointment with this doctor on that day."],
  LIMIT: ["RATE_LIMITED", `You can have up to ${MAX_UPCOMING} upcoming appointments. Cancel one, or contact the clinic.`],
  NOT_CHANGEABLE: ["INVALID_TRANSITION", "This appointment can no longer be changed online. Please contact the clinic."],
  ONLINE_UNAVAILABLE: ["INVALID_INPUT", "This doctor doesn't offer online consultations. Choose an in-person visit or another doctor."],
};

/** True when the booking functions don't exist yet (migration not applied). */
export function isMissingBookingSchema(err: unknown): boolean {
  return /function app\.(patient_book_appointment|patient_cancel_appointment|patient_reschedule_appointment|patient_doctor_busy_slots)\([^)]*\) does not exist/i.test(errorText(err));
}

/** Maps a 'patient booking: <CODE>' refusal (or a missing migration) to an API error; anything else is rethrown. */
export function mapBookingDbError(err: unknown): never {
  if (isMissingBookingSchema(err)) throw new DataError("FEATURE_UNAVAILABLE", "Online booking isn't available yet. Please call the clinic to book.");
  const m = /patient booking: ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  if (m[1] === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (m[1] === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = MESSAGES[m[1]];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

/** Short, human appointment reference. */
export const appointmentReference = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

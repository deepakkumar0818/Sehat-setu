// Fixed notification templates. Stored notifications carry only a type, a
// reference id and a few allow-listed values (migration
// 20261019000000_notifications); this module turns them into text. Nothing here
// reads patient or clinical data, and unknown or malformed values are dropped,
// never echoed. Pure module (unit-tested).
import type { NotificationTypeKey } from "@/lib/live-types";

export interface StoredNotification {
  type: string;
  refId: string | null;
  branchId: string | null;
  data: unknown;
}

export interface RenderedNotification {
  type: NotificationTypeKey;
  title: string;
  body: string;
  link: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_LABEL: Record<string, string> = { DOCTOR: "Doctor", CLINIC_MANAGER: "Clinic Manager", RECEPTIONIST: "Receptionist", NURSE: "Nurse" };

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** The allow-listed `data` keys, validated. Anything else in the object is ignored. */
export function readData(data: unknown) {
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);
  return {
    startsAt: date(d.startsAt),
    previousStartsAt: date(d.previousStartsAt),
    branchId: typeof d.branchId === "string" && UUID.test(d.branchId) ? d.branchId : null,
    reason: d.reason === "reassigned" ? ("reassigned" as const) : d.reason === "cancelled" ? ("cancelled" as const) : null,
    // A shared-catalogue medicine name (public reference data), trimmed and length-limited.
    medicineName: typeof d.medicineName === "string" ? d.medicineName.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 120) || null : null,
    usable: int(d.usable),
    reorderLevel: int(d.reorderLevel),
    role: typeof d.role === "string" && d.role in ROLE_LABEL ? d.role : null,
  };
}

const when = (d: Date | null) => (d ? fmt.format(d) : "an upcoming time");
const at = (branchName: string | null) => (branchName ? ` at ${branchName}` : "");

/**
 * Text and link for one stored notification. `branchName` resolves a branch id
 * the reader can see (null if not). Returns null for an unknown type.
 */
export function renderNotification(n: StoredNotification, branchName: (id: string | null) => string | null): RenderedNotification | null {
  const d = readData(n.data);
  switch (n.type) {
    case "APPOINTMENT_BOOKED":
      return { type: "appointment_booked", title: "New appointment booked", body: `A patient was booked with you for ${when(d.startsAt)}${at(branchName(d.branchId))}.`, link: "/appointments" };
    case "APPOINTMENT_RESCHEDULED":
      return {
        type: "appointment_rescheduled",
        title: "Appointment rescheduled",
        body: `An appointment${d.previousStartsAt ? ` on ${when(d.previousStartsAt)}` : ""} moved to ${when(d.startsAt)}${at(branchName(d.branchId))}.`,
        link: "/appointments",
      };
    case "APPOINTMENT_CANCELLED":
      return d.reason === "reassigned"
        ? { type: "appointment_cancelled", title: "Appointment reassigned", body: `Your appointment on ${when(d.startsAt)}${at(branchName(d.branchId))} was moved to another doctor.`, link: "/appointments" }
        : { type: "appointment_cancelled", title: "Appointment cancelled", body: `Your appointment on ${when(d.startsAt)}${at(branchName(d.branchId))} was cancelled.`, link: "/appointments" };
    case "APPOINTMENT_CHECKED_IN":
      return { type: "appointment_checked_in", title: "Patient checked in", body: `Your patient for ${when(d.startsAt)}${at(branchName(d.branchId))} has checked in.`, link: "/waiting-room" };
    case "STOCK_LOW":
    case "STOCK_OUT": {
      const branch = branchName(n.branchId);
      const medicine = d.medicineName ?? "A medicine";
      const link = n.branchId && n.refId && UUID.test(n.branchId) && UUID.test(n.refId) ? `/inventory/${n.branchId}/${n.refId}` : "/inventory";
      return n.type === "STOCK_OUT"
        ? { type: "stock_out", title: "Out of stock", body: `${medicine} is out of usable stock${at(branch)}.`, link }
        : { type: "stock_low", title: "Low stock", body: `${medicine} is down to ${d.usable ?? "few"} usable units${at(branch)} (reorder level ${d.reorderLevel ?? "—"}).`, link };
    }
    case "STAFF_INVITATION_ACCEPTED":
      return {
        type: "staff_invitation_accepted",
        title: "Invitation accepted",
        body: `A new ${d.role ? ROLE_LABEL[d.role] : "team member"} joined${at(branchName(d.branchId))}.`,
        link: "/staff?tab=invitations",
      };
    default:
      return null;
  }
}

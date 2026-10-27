// Pure conversions between database rows and the UI's existing types
// (src/types/index.ts), so client components work unchanged on live data.
// Nothing here invents clinical or business values: fields the database
// doesn't hold are left empty/null, never filled with sample data.
import { AVATAR_COLORS } from "@/data/pools";
import { DEFAULT_TIMINGS, slotTimesFor, WEEKDAYS } from "@/lib/clinic-hours";
import type { WeeklyHours } from "@/lib/live-types";
import { istDayKey } from "@/lib/ist";
import type { AppointmentStatus, AppointmentType, Doctor, DoctorAvailabilitySlot, Gender, Patient, PaymentStatus } from "@/types";

const IST_OFFSET_MS = 330 * 60 * 1000;

/** UTC instant for an IST calendar date (yyyy-MM-dd) and wall-clock time (HH:mm). */
export function istToInstant(date: string, time: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error("Invalid date or time");
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Reject impossible dates like 2026-02-31 (Date.UTC would silently roll them over).
  if (utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d || h > 23 || mi > 59) throw new Error("Invalid date or time");
  return new Date(utc.getTime() - IST_OFFSET_MS);
}

/** Presentation-only colour, stable per record id. */
export function avatarColorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function ageFrom(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return Math.max(0, age);
}

// --- enums -----------------------------------------------------------------

export type DbAppointmentStatus = "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "PENDING_APPROVAL" | "REJECTED";

/** Patient requests awaiting or refused by reception: never part of a doctor's schedule or appointment counts. */
export const REVIEW_STATUSES: DbAppointmentStatus[] = ["PENDING_APPROVAL", "REJECTED"];
export type DbAppointmentType = "IN_PERSON" | "ONLINE" | "FOLLOW_UP" | "WALK_IN";

const STATUS_TO_UI: Record<DbAppointmentStatus, AppointmentStatus> = {
  SCHEDULED: "upcoming",
  CONFIRMED: "upcoming",
  CHECKED_IN: "waiting",
  IN_CONSULTATION: "in_consultation",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
  PENDING_APPROVAL: "pending_approval",
  REJECTED: "rejected",
};

export const appointmentStatusToUi = (s: DbAppointmentStatus): AppointmentStatus => STATUS_TO_UI[s];

/** DB statuses matching a UI status filter ("upcoming" covers scheduled and confirmed). */
export function appointmentStatusFromUi(s: AppointmentStatus): DbAppointmentStatus[] {
  return (Object.keys(STATUS_TO_UI) as DbAppointmentStatus[]).filter((k) => STATUS_TO_UI[k] === s);
}

export const appointmentTypeToUi = (t: DbAppointmentType) => t.toLowerCase() as AppointmentType;
export const appointmentTypeFromUi = (t: AppointmentType) => t.toUpperCase() as DbAppointmentType;

export const genderToUi = (g: "MALE" | "FEMALE" | "OTHER") => g.toLowerCase() as Gender;
export const genderFromUi = (g: Gender) => g.toUpperCase() as "MALE" | "FEMALE" | "OTHER";

export function invoiceStatusToPayment(status: string | null | undefined): PaymentStatus {
  if (status === "PAID") return "paid";
  if (status === "PARTIALLY_PAID") return "partial";
  return "pending";
}

// --- default schedule --------------------------------------------------------

/**
 * The database has no per-doctor working hours yet, so live mode uses the
 * clinic's standard hours (the same defaults new doctors got in the mock app):
 * Mon–Sat 09:00–17:00, lunch 13:00–14:00, 30-minute slots.
 */
export const DEFAULT_WEEKLY_HOURS: DoctorAvailabilitySlot[] = (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((day) => ({
  day,
  start: "09:00",
  end: "17:00",
}));

/** Slots under the default timings (a clinic's own come from Settings: slotTimesFor). */
export function defaultSlotsFor(dateIso: string): string[] {
  return slotTimesFor(dateIso, DEFAULT_TIMINGS);
}

// --- records -------------------------------------------------------------------

export interface DbPatientRow {
  id: string;
  clinicId: string;
  branchId: string;
  patientNumber: string;
  name: string;
  dateOfBirth: Date;
  gender: "MALE" | "FEMALE" | "OTHER";
  phone: string;
  email: string | null;
  bloodGroup: string | null;
  addressLine: string | null;
  city: string | null;
  allergies: string[];
  chronicConditions: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  createdAt: Date;
}

export function toUiPatient(row: DbPatientRow, extra: { lastVisit?: string; nextAppointmentId?: string } = {}, now: Date = new Date()): Patient {
  return {
    id: row.id,
    patientNumber: row.patientNumber,
    name: row.name,
    age: ageFrom(row.dateOfBirth, now),
    dob: row.dateOfBirth.toISOString().slice(0, 10),
    gender: genderToUi(row.gender),
    phone: row.phone,
    email: row.email ?? "",
    bloodGroup: row.bloodGroup ?? "Unknown",
    address: row.addressLine ?? "",
    city: row.city ?? "",
    branchId: row.branchId,
    status: row.status.toLowerCase() as Patient["status"],
    allergies: row.allergies,
    chronicConditions: row.chronicConditions,
    registeredDate: istDayKey(row.createdAt).date,
    lastVisit: extra.lastVisit,
    nextAppointmentId: extra.nextAppointmentId,
    avatarColor: avatarColorFor(row.id),
    emergencyContact: { name: row.emergencyContactName ?? "", phone: row.emergencyContactPhone ?? "", relation: "" },
  };
}

export interface DbDoctorRow {
  id: string;
  clinicId: string;
  specialtyId: string;
  departmentId: string | null;
  qualifications: string;
  registrationNumber: string;
  experienceYears: number;
  consultationFeePaise: number;
  bio: string | null;
  onlineConsultation: boolean;
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
  user: { name: string; email: string; phone: string | null };
  specialty: { name: string };
  branches: { branchId: string; isPrimary: boolean }[];
}

/** The clinic's open days as the UI's weekly availability ("Mon" 09:00–17:00, …). */
export function availabilityFrom(hours: WeeklyHours): DoctorAvailabilitySlot[] {
  return WEEKDAYS.flatMap((d) => {
    const h = hours[d];
    return h ? [{ day: (d[0].toUpperCase() + d.slice(1)) as DoctorAvailabilitySlot["day"], start: h.open, end: h.close }] : [];
  });
}

/** `availability`: the clinic's timings (every doctor books on them); the defaults when not given. */
export function toUiDoctor(row: DbDoctorRow, availability: DoctorAvailabilitySlot[] = DEFAULT_WEEKLY_HOURS): Doctor {
  const primary = row.branches.find((b) => b.isPrimary) ?? row.branches[0];
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.user.name,
    qualifications: row.qualifications,
    specialization: row.specialty.name,
    specialtyId: row.specialtyId,
    departmentId: row.departmentId ?? undefined,
    registrationNumber: row.registrationNumber,
    experienceYears: row.experienceYears,
    consultationFee: row.consultationFeePaise / 100,
    branchId: primary?.branchId ?? "",
    phone: row.user.phone ?? "",
    email: row.user.email,
    status: row.status === "ACTIVE" ? "active" : "inactive",
    onlineConsultation: row.onlineConsultation,
    rating: null, // no ratings are stored
    avatarColor: avatarColorFor(row.id),
    bio: row.bio ?? "",
    availability,
    joinedDate: istDayKey(row.createdAt).date,
  };
}

export const ROLE_KEY_TO_STAFF_ROLE = {
  ADMINISTRATOR: "clinic_admin",
  CLINIC_MANAGER: "branch_manager",
  RECEPTIONIST: "receptionist",
  NURSE: "nurse",
} as const;

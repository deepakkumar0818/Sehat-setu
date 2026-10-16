import { z } from "zod";
import { phoneSchema } from "@/lib/phone";

// First-login patient onboarding (P6.5): the three steps' validation, shared by
// the portal dialog (inline errors) and the Server Actions (authority before
// the database, which checks everything again: migration 20261023000000).
//
// Everything collected here is PATIENT-REPORTED. It is stored apart from the
// clinic's own patient record (which onboarding never changes), it is never a
// clinician-confirmed diagnosis, and nothing in it identifies or links a
// patient record — linking stays with the clinic's one-time code.
// Schemas are strict: a browser can't add a patient, clinic or user id.
// Error messages never repeat what was typed.

export const INTAKE_STEPS = [
  { step: 1, title: "Personal information" },
  { step: 2, title: "Medical history" },
  { step: 3, title: "Current symptoms" },
] as const;
export type IntakeStep = 1 | 2 | 3;

export const GENDERS = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
] as const;
export type IntakeGender = (typeof GENDERS)[number]["value"];

export const ALLERGY_STATUSES = [
  { value: "HAS_ALLERGIES", label: "I have allergies" },
  { value: "NONE_KNOWN", label: "No known allergies" },
  { value: "UNKNOWN", label: "Unknown / not yet confirmed" },
] as const;
/** NOT_ANSWERED is the default ("not answered yet"), distinct from an explicit UNKNOWN or NONE_KNOWN. */
export type AllergyStatus = "NOT_ANSWERED" | (typeof ALLERGY_STATUSES)[number]["value"];

export const ONSETS = [
  { value: "TODAY", label: "Today" },
  { value: "DAYS_1_3", label: "1–3 days ago" },
  { value: "DAYS_4_7", label: "4–7 days ago" },
  { value: "WEEKS_1_4", label: "1–4 weeks ago" },
  { value: "OVER_1_MONTH", label: "More than a month ago" },
  { value: "UNSURE", label: "Not sure" },
] as const;
export type SymptomOnset = (typeof ONSETS)[number]["value"];

export const SEVERITIES = [
  { value: "MILD", label: "Mild" },
  { value: "MODERATE", label: "Moderate" },
  { value: "SEVERE", label: "Severe" },
] as const;
export type SymptomSeverity = (typeof SEVERITIES)[number]["value"];

export const MAX_ITEMS = 30;

// --- Shared field helpers -----------------------------------------------------

const text = (max: number, required: string | null) => {
  const base = z.string().trim().max(max, `Keep this under ${max} characters.`);
  return required ? base.min(1, required) : base;
};
/** Optional text: "" and missing become null. */
const optionalText = (max: number) =>
  z.preprocess((v) => (v === undefined || v === null ? "" : v), text(max, null)).transform((s) => (s === "" ? null : s));

/** The application's time zone (clinics are in India; reports and the database checks use it too). */
export const APP_TIME_ZONE = "Asia/Kolkata";
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * "Today" (YYYY-MM-DD) in the application's time zone — the same day the
 * database's check uses ((now() AT TIME ZONE 'Asia/Kolkata')::date), whatever
 * the browser's or server's own time zone.
 */
export function todayInAppZone(now: Date = new Date()): string {
  return ymd.format(now);
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30 and the like). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function dateOfBirthSchema(today: () => string = () => todayInAppZone()) {
  return z
    .string({ required_error: "Enter your date of birth." })
    .trim()
    .min(1, "Enter your date of birth.")
    .refine(isRealDate, "Enter a real date (day, month and year).")
    .refine((v) => !isRealDate(v) || v >= "1900-01-01", "Enter a date after 1 January 1900.")
    .refine((v) => !isRealDate(v) || v <= today(), "Your date of birth can't be in the future.");
}

const optionalPhone = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), phoneSchema.optional()).transform((v) => v ?? null);

// --- Step 1: personal information -------------------------------------------------

export function personalSchema(today?: () => string) {
  return z
    .object({
      legalName: text(200, "Enter your full legal name."),
      dateOfBirth: dateOfBirthSchema(today),
      gender: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(["FEMALE", "MALE", "OTHER"]).nullable()),
      phone: phoneSchema,
      addressLine: text(300, "Enter your address."),
      city: text(100, "Enter your city or town."),
      state: optionalText(100),
      postalCode: optionalText(20).refine((v) => v === null || /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(v), "Enter a valid postal code."),
      emergencyContactName: optionalText(120),
      emergencyContactRelationship: optionalText(60),
      emergencyContactPhone: optionalPhone,
    })
    .strict()
    .superRefine((v, ctx) => {
      // An emergency contact needs both a name and a phone number (or neither).
      if (v.emergencyContactName && !v.emergencyContactPhone) ctx.addIssue({ code: "custom", path: ["emergencyContactPhone"], message: "Add your emergency contact's phone number, or clear their name." });
      if (!v.emergencyContactName && v.emergencyContactPhone) ctx.addIssue({ code: "custom", path: ["emergencyContactName"], message: "Add your emergency contact's name, or clear their phone number." });
      if (!v.emergencyContactName && v.emergencyContactRelationship) ctx.addIssue({ code: "custom", path: ["emergencyContactName"], message: "Add your emergency contact's name." });
    });
}
export type PersonalInput = z.input<ReturnType<typeof personalSchema>>;
export type PersonalData = z.output<ReturnType<typeof personalSchema>>;

// --- Step 2: medical history (all optional) ------------------------------------------

export const allergySchema = z.object({ substance: text(120, "Enter what you're allergic to."), reaction: optionalText(120) }).strict();
export const medicationSchema = z.object({ name: text(120, "Enter the medicine's name."), dose: optionalText(120), frequency: optionalText(120) }).strict();

export const medicalSchema = z
  .object({
    allergyStatus: z.enum(["NOT_ANSWERED", "UNKNOWN", "NONE_KNOWN", "HAS_ALLERGIES"]).default("NOT_ANSWERED"),
    allergies: z.array(allergySchema).max(MAX_ITEMS, `Add at most ${MAX_ITEMS} allergies.`).default([]),
    medications: z.array(medicationSchema).max(MAX_ITEMS, `Add at most ${MAX_ITEMS} medicines.`).default([]),
    conditions: z.array(text(120, "Enter the condition, or remove this row.")).max(MAX_ITEMS, `Add at most ${MAX_ITEMS} conditions.`).default([]),
    pastSurgeries: optionalText(2000),
    familyHistory: optionalText(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.allergyStatus === "HAS_ALLERGIES" && v.allergies.length === 0) ctx.addIssue({ code: "custom", path: ["allergies"], message: "Add at least one allergy, or choose another answer." });
    if (v.allergyStatus !== "HAS_ALLERGIES" && v.allergies.length > 0) ctx.addIssue({ code: "custom", path: ["allergyStatus"], message: "Choose “I have allergies” to keep the allergies you listed." });
  });
export type MedicalInput = z.input<typeof medicalSchema>;
export type MedicalData = z.output<typeof medicalSchema>;

// --- Step 3: current symptoms (optional; patient-reported, never a diagnosis) ----------

export const symptomSchema = z
  .object({
    /** Generated once per form in the browser: a repeated submission returns the first report. */
    requestId: z.string().uuid(),
    appointmentId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()),
    reason: text(300, "Tell us the main reason you're seeking care."),
    symptoms: text(2000, "Describe your symptoms."),
    onset: z.enum(["TODAY", "DAYS_1_3", "DAYS_4_7", "WEEKS_1_4", "OVER_1_MONTH", "UNSURE"], { errorMap: () => ({ message: "Choose when your symptoms started." }) }),
    severity: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(["MILD", "MODERATE", "SEVERE"]).nullable()),
    notes: optionalText(2000),
  })
  .strict();
export type SymptomInput = z.input<typeof symptomSchema>;
export type SymptomData = z.output<typeof symptomSchema>;

// --- State sent to the portal --------------------------------------------------------------

export type AllergyItem = { substance: string; reaction: string | null };
export type MedicationItem = { name: string; dose: string | null; frequency: string | null };

/** What the dialog shows: the patient's own saved answers (or, before step 1 is saved, the clinic record's contact details as a starting point). */
export interface IntakeProfileView {
  legalName: string;
  dateOfBirth: string;
  gender: IntakeGender | null;
  phone: string;
  addressLine: string;
  city: string;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
}

export interface IntakeMedicalView {
  allergyStatus: AllergyStatus;
  allergies: AllergyItem[];
  medications: MedicationItem[];
  conditions: string[];
  pastSurgeries: string | null;
  familyHistory: string | null;
}

export interface IntakeAppointmentOption {
  id: string;
  startsAt: string;
  branchName: string | null;
  doctorName: string | null;
}

export type IntakeState =
  | { available: false }
  | {
      available: true;
      /** From the server-side profile row; never from the browser. */
      completed: boolean;
      progress: IntakeProgress;
      /** Saved answers, or a prefill from the clinic record (personalSaved false). */
      personal: Partial<IntakeProfileView>;
      medical: IntakeMedicalView | null;
      /** The patient's own upcoming appointments (for linking step 3). */
      appointments: IntakeAppointmentOption[];
      /** Symptom questionnaires sent in the last 30 days (count only). */
      recentSymptomReports: number;
    };

export interface IntakeProgress {
  personalSaved: boolean;
  medicalReviewed: boolean;
  completed: boolean;
}

/** Where an interrupted onboarding resumes. */
export function resumeStep(p: IntakeProgress): IntakeStep {
  if (!p.personalSaved) return 1;
  if (!p.medicalReviewed) return 2;
  return 3;
}

/**
 * Whether the dialog opens by itself. Only server state decides "complete";
 * `dismissedThisSession` (the patient chose "Finish later" in this browser
 * session) only postpones it until the next sign-in.
 */
export function shouldAutoOpen(state: IntakeState, dismissedThisSession: boolean): boolean {
  return state.available && !state.completed && !dismissedThisSession;
}

/** Field errors from a failed parse: messages only (never the values typed). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const apptFmt = new Intl.DateTimeFormat("en-IN", { timeZone: APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
/** An appointment's start, shown in the application's time zone (not the browser's). */
export function appointmentWhen(iso: string): string {
  return apptFmt.format(new Date(iso));
}

// --- Staff review (patient-reported; never clinician-confirmed) ------------------------

export interface PatientReportedSymptom {
  id: string;
  createdAt: string;
  /** The linked appointment's start, when the caller may see that appointment. */
  appointmentAt: string | null;
  appointmentLinked: boolean;
  reason: string;
  symptoms: string;
  onset: SymptomOnset;
  severity: SymptomSeverity | null;
  notes: string | null;
}

export interface PatientReportedView {
  profile:
    | (IntakeProfileView &
        IntakeMedicalView & { personalSavedAt: string; medicalReviewedAt: string | null; completedAt: string | null; updatedAt: string })
    | null;
  /** Newest first, at most 20. */
  symptomReports: PatientReportedSymptom[];
}

export const ALLERGY_STATUS_LABEL: Record<AllergyStatus, string> = {
  NOT_ANSWERED: "Not answered",
  UNKNOWN: "Unknown / not yet confirmed",
  NONE_KNOWN: "No known allergies",
  HAS_ALLERGIES: "Has allergies",
};
export const labelOf = <T extends string>(list: readonly { value: T; label: string }[], v: T | null) => (v ? (list.find((x) => x.value === v)?.label ?? v) : null);

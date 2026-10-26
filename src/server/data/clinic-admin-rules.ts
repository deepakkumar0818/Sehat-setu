import { z } from "zod";
import type { AuditArea, LiveExpenseCategory } from "@/lib/live-types";

// Pure rules for the clinic-admin screens (branches, departments, lab tests,
// clinic profile, audit log, expenses). Shared by the server modules and unit tests.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{6,18}[0-9]$/, "Enter a valid phone number");
const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();

/** Path ids are checked before they reach a uuid column (a malformed id is simply "not found"). */
export const isUuid = (id: string) => uuid.safeParse(id).success;

// --- Branches ------------------------------------------------------------------

export const branchCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "Use 2–16 letters, digits or dashes");

export const branchInputSchema = z.object({
  name: text(120),
  code: z.union([branchCodeSchema, z.literal("")]).optional().transform((v) => v || undefined),
  city: text(80),
  address: text(300),
  phone,
  email: z.union([email, z.literal("")]).optional().nullable().transform((v) => v || null),
});

export const branchPatchSchema = z.union([
  z.object({ status: z.enum(["active", "inactive"]) }).strict(),
  branchInputSchema.omit({ code: true }).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to change"),
]);

/** A code from the branch name: initials (or the first letters of one word), e.g. "Baner Road" → "BR". */
export function branchCodeFromName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const base = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "BR").slice(0, 3);
  return (base.length >= 2 ? base : `${base}B`).slice(0, 12);
}

/** First free code: base, base-2, base-3, … */
export function nextFreeCode(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  throw new Error("no free branch code");
}

// --- Clinic specialties ----------------------------------------------------------

export const specialtyInputSchema = z.object({ name: text(80), description: optionalText(300) });
export const specialtyPatchSchema = specialtyInputSchema.partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to change");

// --- Lab test master -----------------------------------------------------------

export const LAB_TEST_CATEGORIES = ["pathology", "radiology", "cardiology", "other"] as const;

// 60: the longest test type a lab report accepts (document-rules.ts), so any ordered test can get a result.
export const labTestInputSchema = z.object({
  name: text(60),
  category: z.enum(LAB_TEST_CATEGORIES).default("other"),
});

export const labTestPatchSchema = z.union([
  z.object({ status: z.enum(["active", "inactive"]) }).strict(),
  z
    .object({ name: text(60), category: z.enum(LAB_TEST_CATEGORIES) })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, "Nothing to change"),
]);

// --- Departments ---------------------------------------------------------------

export const departmentInputSchema = z.object({
  name: text(120),
  description: optionalText(300),
  branchId: uuid.optional().nullable().transform((v) => v ?? null),
  specialtyId: uuid.optional().nullable().transform((v) => v ?? null),
});

export const departmentPatchSchema = z.union([
  z.object({ status: z.enum(["active", "inactive"]) }).strict(),
  z
    .object({ name: text(120), description: optionalText(300), specialtyId: uuid.nullable() })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, "Nothing to change"),
]);

// --- Clinic profile --------------------------------------------------------------

export const clinicProfileSchema = z
  .object({
    name: text(120),
    email,
    phone,
    addressLine: text(300),
    city: text(80),
    state: text(80),
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code"),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

// --- Audit log -------------------------------------------------------------------

export const AUDIT_AREAS: readonly AuditArea[] = ["sign_in", "access", "patients", "appointments", "clinical", "billing", "inventory", "staff", "setup", "other"];

const TABLE_AREA: Record<string, AuditArea> = {
  patients: "patients",
  patient_link_codes: "patients",
  patient_intake_profiles: "patients",
  patient_symptom_reports: "patients",
  patient_documents: "clinical",
  appointments: "appointments",
  consultations: "clinical",
  prescriptions: "clinical",
  prescription_items: "clinical",
  lab_reports: "clinical",
  invoices: "billing",
  payments: "billing",
  expenses: "billing",
  inventory_items: "inventory",
  inventory_reorder_levels: "inventory",
  stock_movements: "inventory",
  medicines: "inventory",
  users: "staff",
  clinic_memberships: "staff",
  staff_invitations: "staff",
  staff_invitation_doctor_details: "staff",
  roles: "staff",
  role_permissions: "staff",
  member_permission_overrides: "staff",
  branches: "setup",
  departments: "setup",
  lab_test_types: "setup",
  specialties: "setup",
  clinics: "setup",
};

/** Action-key prefixes per area (for filtering in the database). */
export function auditActionPrefixes(area: AuditArea): string[] {
  if (area === "sign_in") return ["auth."];
  if (area === "access") return ["access."];
  return Object.entries(TABLE_AREA).filter(([, a]) => a === area).map(([t]) => `${t}.`);
}

export function auditArea(action: string): AuditArea {
  if (action.startsWith("auth.")) return "sign_in";
  if (action.startsWith("access.")) return "access";
  return TABLE_AREA[action.split(".")[0]] ?? "other";
}

const NOUN: Record<string, string> = {
  patients: "a patient record",
  patient_link_codes: "a portal linking code",
  patient_intake_profiles: "a patient's health profile",
  patient_symptom_reports: "a symptom report",
  patient_documents: "a patient document",
  appointments: "an appointment",
  consultations: "a consultation",
  prescriptions: "a prescription",
  prescription_items: "a prescription item",
  lab_reports: "a lab report",
  invoices: "an invoice",
  payments: "a payment",
  expenses: "an expense",
  inventory_items: "a stock batch",
  inventory_reorder_levels: "a reorder level",
  stock_movements: "a stock movement",
  medicines: "a catalogue medicine",
  users: "a user account",
  clinic_memberships: "a staff membership",
  staff_invitations: "a staff invitation",
  staff_invitation_doctor_details: "a doctor invitation",
  roles: "a role",
  role_permissions: "a role permission",
  member_permission_overrides: "a staff member's permissions",
  branches: "a branch",
  departments: "a department",
  lab_test_types: "a lab test",
  specialties: "a specialty",
  clinics: "the clinic profile",
};

const AUTH_SUMMARY: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "auth.account_linked": "Linked a sign-in to an account",
  "auth.password_reset_requested": "Requested a password reset",
  "auth.sign_up_requested": "Started a patient sign-up",
  "auth.sign_up_otp_verified": "Verified a sign-up email code",
  "access.denied": "Was denied access",
};

/** "Updated a branch", "Signed in", … — from the action key only (no row values). */
export function auditSummary(action: string, outcome: "SUCCESS" | "DENIED" | "FAILURE", changed: readonly string[] = []): string {
  const known = AUTH_SUMMARY[action];
  if (known) return outcome === "SUCCESS" || action === "access.denied" ? known : `${known} (failed)`;
  const [table, op] = action.split(".");
  const noun = NOUN[table];
  if (!noun) return action;
  if (op === "insert") return `Created ${noun}`;
  if (op === "delete") return `Deleted ${noun}`;
  if (op === "update") {
    if (changed.length === 1 && changed[0] === "status") return `Changed the status of ${noun}`;
    return `Updated ${noun}`;
  }
  return action;
}

export const auditQuerySchema = z.object({
  area: z.enum(AUDIT_AREAS as [AuditArea, ...AuditArea[]]).optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// --- Expenses --------------------------------------------------------------------

export const EXPENSE_CATEGORIES: readonly LiveExpenseCategory[] = ["rent", "salary", "utilities", "equipment", "medicine_purchase", "lab_expense", "marketing", "maintenance", "other"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Invalid date");

/** Rupees with at most two decimals → integer paise (1 paisa … ₹2 crore). */
export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export function expenseInputSchema(todayIst: string) {
  return z.object({
    branchId: uuid,
    category: z.enum(EXPENSE_CATEGORIES as [LiveExpenseCategory, ...LiveExpenseCategory[]]),
    description: text(200),
    amount: z
      .number()
      .finite()
      .positive("Enter an amount above zero")
      .max(20_000_000, "That amount is too large")
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use at most two decimals"),
    date: isoDate.refine((d) => d <= todayIst, "An expense can't be dated in the future").refine((d) => d >= "2000-01-01", "Invalid date"),
    paidTo: optionalText(120),
    reference: optionalText(64),
  });
}

export const voidExpenseSchema = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(300) });

export const expenseQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.enum(EXPENSE_CATEGORIES as [LiveExpenseCategory, ...LiveExpenseCategory[]]).optional(),
  branchId: uuid.optional(),
  status: z.enum(["recorded", "voided", "all"]).optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

/** First day of the IST month containing `todayIst` (yyyy-MM-dd). */
export const monthStart = (todayIst: string) => `${todayIst.slice(0, 8)}01`;

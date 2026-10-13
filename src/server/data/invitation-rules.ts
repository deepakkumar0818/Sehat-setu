// Pure rules for staff invitations, shared by the data module and its tests.
// The database functions in migration 20261019000100_staff_invitations are the
// authority (they re-check everything); these give early, friendly validation
// and turn the functions' 'staff invitation: <CODE>' refusals into API errors.
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { DataError, type DataErrorCode } from "@/server/api/errors";
import { INVITABLE_ROLES, type DeliveryState, type InvitationState } from "@/lib/live-types";
import { phoneSchema } from "@/lib/phone";

export const INVITATION_EXPIRY_DAYS = 7;
export const RESEND_COOLDOWN_MS = 2 * 60_000;
export const MAX_SEND_ATTEMPTS = 10;
export const CREATE_LIMIT_PER_HOUR = 50;
/** A send still "in progress" after this long is shown as "unknown" (its outcome was never recorded). */
export const SENDING_STALE_MS = RESEND_COOLDOWN_MS;
/** ₹1,00,000 = 10,000,000 paise (the database CHECK limit). */
export const MAX_FEE_RUPEES = 100_000;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const text = (label: string, min: number, max: number) =>
  z
    .string()
    .refine((s) => !CONTROL.test(s.replace(/\s/g, " ")), `${label} contains invalid characters.`)
    .transform(tidy)
    .pipe(z.string().min(min, `${label} must be at least ${min} characters.`).max(max, `${label} must be at most ${max} characters.`));

export const doctorDetailsSchema = z
  .object({
    specialtyId: z.string().uuid("Choose a specialty."),
    qualifications: text("Qualifications", 2, 200),
    registrationNumber: text("Registration number", 3, 40),
    experienceYears: z.number().int("Experience must be whole years.").min(0).max(70),
    consultationFee: z
      .number()
      .min(0, "The fee can't be negative.")
      .max(MAX_FEE_RUPEES, "The fee is too high.")
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most two decimal places."),
    onlineConsultation: z.boolean(),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
    name: text("Name", 2, 120),
    roleKey: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: "Choose a role that can be invited." }) }),
    branchId: z.string().uuid("Choose a branch."),
    phone: phoneSchema,
    doctor: doctorDetailsSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.roleKey === "DOCTOR" && !v.doctor) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["doctor"], message: "Doctor details are required." });
    if (v.roleKey !== "DOCTOR" && v.doctor) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["doctor"], message: "Doctor details are only for doctors." });
  });

export type CreateInvitationData = z.infer<typeof createInvitationSchema>;

/** Rupees (as entered) → integer paise. */
export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export const listInvitationsSchema = z.object({
  status: z.enum(["pending", "expired", "accepted", "revoked", "all"]).optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

// --- Derived states ------------------------------------------------------------

export interface InvitationRowLike {
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: Date;
  deliveryStatus: "NOT_SENT" | "SENDING" | "SENT" | "FAILED";
  sendAttempts: number;
  lastAttemptAt: Date | null;
}

export function invitationState(row: InvitationRowLike, now: Date): InvitationState {
  if (row.status === "ACCEPTED") return "accepted";
  if (row.status === "REVOKED") return "revoked";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export function deliveryState(row: InvitationRowLike, now: Date): DeliveryState {
  switch (row.deliveryStatus) {
    case "SENT":
      return "sent";
    case "FAILED":
      return "failed";
    case "NOT_SENT":
      return "not_sent";
    case "SENDING":
      return row.lastAttemptAt && now.getTime() - row.lastAttemptAt.getTime() > SENDING_STALE_MS ? "unknown" : "sending";
  }
}

/** Resend/revoke availability for someone allowed to manage invitations. */
export function invitationActions(row: InvitationRowLike, canManage: boolean, now: Date) {
  const pending = row.status === "PENDING"; // includes expired: a resend renews it
  const cooldownEnds = row.lastAttemptAt ? row.lastAttemptAt.getTime() + RESEND_COOLDOWN_MS : 0;
  return {
    canResend: canManage && pending && row.sendAttempts < MAX_SEND_ATTEMPTS && cooldownEnds <= now.getTime(),
    canRevoke: canManage && pending,
    resendAvailableAt: canManage && pending && row.sendAttempts < MAX_SEND_ATTEMPTS && cooldownEnds > now.getTime() ? new Date(cooldownEnds).toISOString() : null,
  };
}

// --- Database refusals -----------------------------------------------------------

const MESSAGES: Partial<Record<string, [DataErrorCode, string]>> = {
  ROLE_NOT_INVITABLE: ["INVALID_INPUT", "That role can't be invited."],
  INVALID_EMAIL: ["INVALID_INPUT", "Enter a valid email address."],
  INVALID_NAME: ["INVALID_INPUT", "Enter the person's name (2–120 characters)."],
  INVALID_PHONE: ["INVALID_INPUT", "Enter a valid phone number with its country code."],
  INVALID_BRANCH: ["INVALID_INPUT", "Choose an active branch you manage."],
  INVALID_SPECIALTY: ["INVALID_INPUT", "Choose a specialty."],
  INVALID_DOCTOR_DETAILS: ["INVALID_INPUT", "Check the doctor's qualifications, registration number, experience and fee."],
  DOCTOR_DETAILS_NOT_ALLOWED: ["INVALID_INPUT", "Doctor details are only for doctors."],
  RATE_LIMITED: ["RATE_LIMITED", "Too many invitations were created in the last hour. Try again later."],
  REGISTRATION_IN_USE: ["REGISTRATION_IN_USE", "A doctor or pending invitation in this clinic already uses that registration number."],
  ALREADY_MEMBER: ["ALREADY_MEMBER", "This person already belongs to this clinic. Change their access from the staff list instead."],
  ALREADY_PATIENT: ["ALREADY_PATIENT", "This email belongs to a patient of this clinic. Patient accounts aren't converted into staff accounts."],
  ALREADY_INVITED: ["ALREADY_INVITED", "This email already has a pending invitation. Resend or revoke it instead."],
  NOT_PENDING: ["NOT_PENDING", "This invitation is no longer pending."],
  TOO_SOON: ["TOO_SOON", "This invitation was sent less than two minutes ago. Wait a moment before resending."],
  TOO_MANY_ATTEMPTS: ["TOO_MANY_ATTEMPTS", "This invitation has reached the maximum of 10 sends. Revoke it and invite again if needed."],
  ALREADY_ACCEPTED: ["ALREADY_ACCEPTED", "This invitation has already been accepted."],
  EXPIRED: ["EXPIRED", "This invitation has expired. Ask your clinic administrator to resend it."],
  REVOKED: ["REVOKED", "This invitation was withdrawn. Ask your clinic administrator if this is a mistake."],
  UNAVAILABLE: ["UNAVAILABLE", "The clinic or branch for this invitation is no longer available."],
  DOCTOR_PROFILE_EXISTS: [
    "DOCTOR_PROFILE_EXISTS",
    "Your account already has a doctor profile with another clinic, and an account can hold only one. Contact the clinic administrator or Sehat Setu support.",
  ],
  EMAIL_MISMATCH: ["EMAIL_MISMATCH", "Sign in with the email address the invitation was sent to."],
};

function errorText(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  return parts.join(" | ");
}

/** The P5 tables/functions aren't in this database yet (migration not applied). */
export function isMissingP5Schema(err: unknown): boolean {
  if ((err as { code?: string })?.code === "P2021") return true;
  return /relation "(public\.)?(notifications|notification_reads|staff_invitations|staff_invitation_doctor_details)" does not exist|function app\.(create_staff_invitation|resend_staff_invitation|record_invitation_delivery|revoke_staff_invitation|my_staff_invitations|accept_staff_invitation)\(.*\) does not exist|type "(NotificationType|NotificationScope|InvitationStatus|InvitationDelivery)" does not exist/.test(
    errorText(err)
  );
}

export function featureUnavailable(feature: "Notifications" | "Staff invitations" | "Phone editing"): DataError {
  return new DataError("FEATURE_UNAVAILABLE", `${feature} aren't set up on this clinic database yet.`);
}

/** Maps a refusal from the app.*_staff_invitation functions to an API error; rethrows anything else. */
export function mapInvitationDbError(err: unknown): never {
  if (isMissingP5Schema(err)) throw featureUnavailable("Staff invitations");
  const m = /staff invitation: ([A-Z_]+)(?: ([0-9a-f-]{36}))?/.exec(errorText(err));
  if (!m) throw err;
  const [, code, id] = m;
  if (code === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (code === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = MESSAGES[code];
  if (!known) throw err;
  throw new DataError(known[0], known[1], code === "ALREADY_INVITED" && id ? { invitationId: id } : undefined);
}

// Pure rules for patient portal linking codes (P6.4), shared by the data module
// and its tests. The database functions in migration
// 20261022000000_patient_link_codes are the authority (they re-check the caller,
// the clinic, the code and the limits); these give early validation and turn
// the functions' results and 'patient link: <CODE>' refusals into API errors.
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { errorText } from "./document-rules";

/** Issue/revoke/status permission (migration 20261022000000: Administrator and Receptionist). */
export const PORTAL_LINK_PERMISSION = "patient.portal_link";
export const LINK_CODE_TTL_HOURS = 72;
export const REDEEM_FAILURES_PER_15_MIN = 5;
export const REDEEM_FAILURES_PER_DAY = 10;

/**
 * The staff member must confirm the clinic's identity-verification procedure
 * was followed. Nothing else is accepted (strict): the patient comes from the URL.
 */
export const issueLinkCodeSchema = z.object({ identityVerified: z.literal(true, { errorMap: () => ({ message: "Confirm that you verified the patient's identity." }) }) }).strict();

/**
 * What the patient sends: the code only. Strict, so a browser can't add a
 * patient or clinic id; the database takes both from the code row.
 */
export const redeemLinkCodeSchema = z.object({ code: z.string().max(64, "That code is too long.") }).strict();

export type RedeemResult = "LINKED" | "ALREADY_LINKED" | "INVALID" | "NOT_ELIGIBLE" | "RATE_LIMITED";
const REDEEM_RESULTS: readonly RedeemResult[] = ["LINKED", "ALREADY_LINKED", "INVALID", "NOT_ELIGIBLE", "RATE_LIMITED"];

export function isRedeemResult(v: unknown): v is RedeemResult {
  return typeof v === "string" && (REDEEM_RESULTS as readonly string[]).includes(v);
}

/** Patient-facing messages. One answer for every unusable code (never which kind). */
export const REDEEM_MESSAGES: Record<Exclude<RedeemResult, "LINKED" | "ALREADY_LINKED">, string> = {
  INVALID: "That code isn't valid or has expired. Check it and try again, or ask your clinic for a new code.",
  NOT_ELIGIBLE: "This code can't be used with this account. Please contact your clinic.",
  RATE_LIMITED: "Too many attempts. Please wait 15 minutes and try again, or ask your clinic for help.",
};

/**
 * The details a patient registers with (kept in their Supabase user_metadata
 * until their record exists). Mirrors app.register_self_patient's checks.
 */
export const selfRegistrationSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{4,29}$/, "Enter a valid phone number."),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth.")
    .refine((v) => !Number.isNaN(Date.parse(v)) && v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10), "Enter a valid date of birth."),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "Choose a gender." }) }),
});
export type SelfRegistration = z.infer<typeof selfRegistrationSchema>;

/**
 * app.register_self_patient (migration 20261027000000): NEEDS_CODE = a record
 * with this email already exists, so only the clinic's single-use code links it.
 */
export type SelfRegisterResult = "LINKED" | "ALREADY_LINKED" | "NEEDS_CODE" | "NOT_ELIGIBLE";
const SELF_REGISTER_RESULTS: readonly SelfRegisterResult[] = ["LINKED", "ALREADY_LINKED", "NEEDS_CODE", "NOT_ELIGIBLE"];

export function isSelfRegisterResult(v: unknown): v is SelfRegisterResult {
  return typeof v === "string" && (SELF_REGISTER_RESULTS as readonly string[]).includes(v);
}

/** Shown in the code as XXXX-XXXX-XXXX-XXXX (Crockford base32, no I, L, O or U). */
export const LINK_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

/** True when the migration hasn't been applied yet (functions missing). */
export function isMissingLinkSchema(err: unknown): boolean {
  return /(function app\.(issue|revoke|redeem)_patient_link_code|function app\.patient_portal_link_status|function app\.(link_patient_by_email|register_self_patient))[^|]*does not exist/i.test(errorText(err));
}

const STAFF_MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  IDENTITY_NOT_CONFIRMED: ["INVALID_INPUT", "Confirm that you verified the patient's identity before issuing a code."],
  PATIENT_INACTIVE: ["UNAVAILABLE", "This patient record is archived, so it can't be linked to a portal account."],
  ALREADY_LINKED: ["CONFLICT", "This patient already has a portal account linked. A new code can't replace it."],
  RATE_LIMITED: ["RATE_LIMITED", "Too many codes have been issued recently. Please wait and try again."],
  EMAIL_NOT_VERIFIED: ["EMAIL_NOT_VERIFIED", "Confirm your email address, then sign in again."],
  INVALID_INPUT: ["INVALID_INPUT", "Some of your registration details aren't valid."],
  CONFLICT: ["CONFLICT", "Your account couldn't be set up. Please try again."],
};

/** Maps a 'patient link: <CODE>' refusal to an API error (anything else is rethrown). */
export function mapPatientLinkDbError(err: unknown): never {
  if (isMissingLinkSchema(err)) throw new DataError("FEATURE_UNAVAILABLE", "Patient portal linking isn't available yet. Please try again later.");
  const m = /patient link: ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  const code = m[1];
  if (code === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (code === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = STAFF_MESSAGES[code];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

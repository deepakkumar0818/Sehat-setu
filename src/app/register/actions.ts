"use server";

import { z } from "zod";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/server/supabase";
import { recordAuditEvent } from "@/server/audit";
import { authCallbackUrl } from "@/lib/auth/site-url";
import { selfRegistrationSchema } from "@/server/data/patient-link-rules";
import { findClinicByCode } from "@/server/data/public-directory";
import { normalizeClinicCode } from "@/lib/clinic-join";
import { logServerError } from "@/server/log";

/** Same minimum as /auth/set-password. 72 = the bcrypt input limit Supabase Auth applies. */
const SIGN_UP_PASSWORD_MIN = 12; // not exported: a "use server" module may export async functions only
const SIGN_UP_PASSWORD_MAX = 72;

export type SignUpResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "weak_password" | "rate_limited" | "closed" | "unavailable" | "not_configured" | "unknown_clinic" };

const emailSchema = z.string().trim().toLowerCase().email().max(254);

const signUpSchema = selfRegistrationSchema
  .extend({
    email: emailSchema,
    password: z.string().min(SIGN_UP_PASSWORD_MIN).max(SIGN_UP_PASSWORD_MAX),
    /** From the clinic's patient link (/join/<CODE>): the clinic the new record joins. */
    clinicCode: z.string().max(10).optional(),
  })
  .strict();

export type JoinClinicInfo = { code: string; name: string; city: string } | null;

/** The clinic a patient link names (name and city only), or null for an unknown or inactive clinic. */
export async function clinicForCodeAction(raw: unknown): Promise<JoinClinicInfo> {
  if (!isSupabaseAuthEnabled()) return null;
  const code = normalizeClinicCode(raw);
  if (!code) return null;
  try {
    const clinic = await findClinicByCode(code);
    return clinic ? { code: clinic.code, name: clinic.name, city: clinic.city } : null;
  } catch (err) {
    logServerError("register clinic lookup", err);
    return null;
  }
}

/**
 * Patient self-registration. Creates a Supabase login only, with the patient's
 * details in its user_metadata; Supabase emails a one-time code (the "Confirm
 * signup" template must include {{ .Token }}) that verifyEmailOtpAction checks.
 * The login gets NO access to clinic data until /link-account links an existing
 * record (clinic-issued single-use code only) or creates a new one from these details.
 *
 * The answer is the same whether or not the email already has a login (no
 * account enumeration): Supabase returns an obfuscated success for an existing
 * address, and an explicit "already exists" is treated the same way.
 */
export async function signUpAction(input: unknown): Promise<SignUpResult> {
  if (!isSupabaseAuthEnabled()) return { ok: false, error: "not_configured" };
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { email, password, clinicCode: rawClinicCode, ...rest } = parsed.data;

  let reason: string | undefined;
  let result: SignUpResult = { ok: true };
  // A patient link's clinic is checked now, so nobody verifies an email only to
  // find the clinic doesn't exist; /link-account creates the record there.
  let clinicCode: string | undefined;
  if (rawClinicCode !== undefined) {
    const code = normalizeClinicCode(rawClinicCode);
    const clinic = code ? await findClinicByCode(code).catch(() => undefined) : null;
    if (clinic === undefined) return { ok: false, error: "unavailable" };
    if (!clinic) return { ok: false, error: "unknown_clinic" };
    clinicCode = clinic.code;
  }
  const details = clinicCode ? { ...rest, clinicCode } : rest;
  try {
    const supabase = await createSupabaseServerClient();
    // The confirmation link returns to THIS app (http://localhost:3000 in
    // development) and continues to the linking-code page. In production
    // without NEXT_PUBLIC_APP_URL no redirect is sent (Supabase's Site URL).
    const emailRedirectTo = authCallbackUrl("/link-account");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: details, ...(emailRedirectTo ? { emailRedirectTo } : {}) } });
    if (error) {
      if (error.code === "weak_password") {
        reason = "weak_password";
        result = { ok: false, error: "weak_password" };
      } else if (error.status === 429) {
        reason = "rate_limited";
        result = { ok: false, error: "rate_limited" };
      } else if (error.code === "signup_disabled") {
        reason = "signup_disabled";
        result = { ok: false, error: "closed" };
      } else if (error.code === "user_already_exists" || error.code === "email_exists") {
        reason = "already_registered"; // same answer as a new address
      } else {
        reason = "provider_error";
        result = { ok: false, error: "unavailable" };
      }
    }
  } catch {
    reason = "unavailable";
    result = { ok: false, error: "unavailable" };
  }
  await recordAuditEvent({ action: "auth.sign_up_requested", outcome: result.ok ? "SUCCESS" : "FAILURE", actorLabel: email, reason });
  return result;
}

export type VerifyOtpResult = { ok: true } | { ok: false; error: "invalid_input" | "invalid_code" | "rate_limited" | "unavailable" | "not_configured" };

const verifyOtpSchema = z.object({ email: emailSchema, token: z.string().trim().regex(/^\d{6,10}$/) }).strict();

/**
 * Checks the code Supabase emailed at sign-up. On success Supabase confirms the
 * email and sets the session cookies, so the browser continues to /link-account.
 * One answer for a wrong, expired or used code.
 */
export async function verifyEmailOtpAction(input: unknown): Promise<VerifyOtpResult> {
  if (!isSupabaseAuthEnabled()) return { ok: false, error: "not_configured" };
  const parsed = verifyOtpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { email, token } = parsed.data;

  let reason: string | undefined;
  let result: VerifyOtpResult = { ok: true };
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      reason = error.status === 429 ? "rate_limited" : (error.code ?? "invalid_code");
      result = { ok: false, error: error.status === 429 ? "rate_limited" : error.status && error.status >= 500 ? "unavailable" : "invalid_code" };
    }
  } catch {
    reason = "unavailable";
    result = { ok: false, error: "unavailable" };
  }
  await recordAuditEvent({ action: "auth.sign_up_otp_verified", outcome: result.ok ? "SUCCESS" : "FAILURE", actorLabel: email, reason });
  return result;
}

/** Emails a fresh sign-up code. Same answer whether or not the address is waiting for one. */
export async function resendEmailOtpAction(input: unknown): Promise<{ ok: boolean; error?: "rate_limited" | "invalid_input" | "not_configured" }> {
  if (!isSupabaseAuthEnabled()) return { ok: false, error: "not_configured" };
  const parsed = emailSchema.safeParse((input as { email?: unknown } | null)?.email);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: parsed.data });
    if (error?.status === 429) return { ok: false, error: "rate_limited" };
  } catch {
    // Same answer as success: the form only says "if it can be sent, it was".
  }
  return { ok: true };
}

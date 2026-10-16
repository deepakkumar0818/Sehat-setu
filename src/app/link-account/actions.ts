"use server";

import { cookies } from "next/headers";
import { ACTIVE_CLINIC_COOKIE, requireAuthUser } from "@/server/auth/session";
import { isAuthError } from "@/server/auth/errors";
import { createSupabaseServerClient } from "@/server/supabase";
import { redeemPortalLinkCode, registerSelfPatient } from "@/server/data/patient-link";
import { REDEEM_MESSAGES, redeemLinkCodeSchema, selfRegistrationSchema } from "@/server/data/patient-link-rules";
import { reportEvent, reportServerError } from "@/server/monitoring";

export type RedeemActionResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "invalid" | "not_eligible" | "rate_limited" | "email_not_verified" | "signed_out" | "unavailable"; message: string };

export type CompleteRegistrationResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "needs_code" | "not_eligible" | "email_not_verified" | "signed_out" | "unavailable"; message: string };

type Failure = { ok: false; error: string; message: string };
const fail = <E extends string>(error: E, message: string) => ({ ok: false as const, error, message }) satisfies Failure;

const setActiveClinic = async (clinicId: string | null) => {
  // A preference only — always re-validated against memberships.
  if (clinicId) (await cookies()).set(ACTIVE_CLINIC_COOKIE, clinicId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
};

/** Shown when a record already carries the patient's email: only the clinic's code connects it. Not exported: a "use server" module may export async functions only. */
const NEEDS_CODE_MESSAGE = "Your clinic already has a patient record with this email. Ask the front desk for a portal linking code and enter it above.";

/**
 * P6.4: links the signed-in (Supabase-verified, email-confirmed) login to the
 * patient record a clinic issued `code` for. Only the code is accepted: the
 * patient and clinic come from the code row in the database, never from the
 * browser. The database records every attempt, limits failures per account and
 * audits the outcome (never the code).
 */
export async function redeemLinkCodeAction(input: unknown): Promise<RedeemActionResult> {
  let authUser;
  try {
    authUser = await requireAuthUser();
  } catch (err) {
    if (isAuthError(err)) return fail("signed_out", "Your session has ended. Please sign in again.");
    return fail("unavailable", "Couldn't reach the sign-in service. Please try again.");
  }
  if (!authUser.emailConfirmed || !authUser.email) {
    return fail("email_not_verified", "Confirm your email address first — enter the code we emailed you, then sign in again.");
  }
  const parsed = redeemLinkCodeSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", REDEEM_MESSAGES.INVALID);

  try {
    const { result, clinicId } = await redeemPortalLinkCode(authUser, parsed.data);
    if (result === "LINKED" || result === "ALREADY_LINKED") {
      await setActiveClinic(clinicId);
      return { ok: true };
    }
    reportEvent("link_code_failure", { scope: "link_code_redeem", reason: result });
    if (result === "RATE_LIMITED") return fail("rate_limited", REDEEM_MESSAGES.RATE_LIMITED);
    if (result === "NOT_ELIGIBLE") return fail("not_eligible", REDEEM_MESSAGES.NOT_ELIGIBLE);
    return fail("invalid", REDEEM_MESSAGES.INVALID);
  } catch (err) {
    console.error("[link-account] redeem failed", err instanceof Error ? err.name : "error");
    reportServerError("action link_code_redeem", err);
    return fail("unavailable", "Couldn't link your account right now. Please try again.");
  }
}

/**
 * A NEW patient (no clinic record carries their email): creates and links their
 * record from the details they enter. Saves the details on the login too, so a
 * retry has them. If a record with this email exists, nothing is created or
 * linked — the answer is needs_code. The clinic never comes from the browser.
 */
export async function completeRegistrationAction(input: unknown): Promise<CompleteRegistrationResult> {
  let authUser;
  try {
    authUser = await requireAuthUser();
  } catch (err) {
    if (isAuthError(err)) return fail("signed_out", "Your session has ended. Please sign in again.");
    return fail("unavailable", "Couldn't reach the sign-in service. Please try again.");
  }
  if (!authUser.emailConfirmed || !authUser.email) return fail("email_not_verified", "Confirm your email address first — enter the code we emailed you, then sign in again.");
  const parsed = selfRegistrationSchema.strict().safeParse(input);
  if (!parsed.success) return fail("invalid_input", parsed.error.issues[0]?.message ?? "Check your details and try again.");

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.updateUser({ data: parsed.data });
    const { result, clinicId } = await registerSelfPatient(authUser, parsed.data);
    if (result === "LINKED" || result === "ALREADY_LINKED") {
      await setActiveClinic(clinicId);
      return { ok: true };
    }
    reportEvent("link_code_failure", { scope: "complete_registration", reason: result });
    if (result === "NEEDS_CODE") return fail("needs_code", NEEDS_CODE_MESSAGE);
    return fail("not_eligible", "Your account can't be set up automatically. Please contact your clinic's front desk.");
  } catch (err) {
    console.error("[link-account] complete registration failed", err instanceof Error ? err.name : "error");
    reportServerError("action complete_registration", err);
    return fail("unavailable", "Couldn't set up your account right now. Please try again.");
  }
}

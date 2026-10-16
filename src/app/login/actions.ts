"use server";

import { z } from "zod";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/server/supabase";
import { recordAuditEvent } from "@/server/audit";
import { reportEvent } from "@/server/monitoring";
import { authCallbackUrl } from "@/lib/auth/site-url";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(256),
});

export type SignInResult = { ok: true } | { ok: false; error: "invalid_credentials" | "email_not_confirmed" | "rate_limited" | "unavailable" | "invalid_input" | "not_configured" };

/**
 * Signs in on the server so every attempt can be audited. The session cookies
 * are set on this response by the Supabase server client. The password is
 * passed straight to Supabase Auth and is never logged or stored.
 */
export async function signInAction(input: { email: string; password: string }): Promise<SignInResult> {
  if (!isSupabaseAuthEnabled()) return { ok: false, error: "not_configured" };
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { email, password } = parsed.data;

  let result: SignInResult;
  let authUserId: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      result = {
        ok: false,
        error:
          error.code === "invalid_credentials"
            ? "invalid_credentials"
            : error.code === "email_not_confirmed"
              ? "email_not_confirmed"
              : error.status === 429
                ? "rate_limited"
                : "unavailable",
      };
    } else {
      authUserId = data.user?.id;
      result = { ok: true };
    }
  } catch {
    result = { ok: false, error: "unavailable" };
  }

  await recordAuditEvent({
    action: "auth.sign_in",
    outcome: result.ok ? "SUCCESS" : "FAILURE",
    actor: { authUserId },
    // The attempted identifier, so repeated failures against one account are visible. Never the password.
    actorLabel: email,
    reason: result.ok ? undefined : result.error,
  });
  if (!result.ok) reportEvent("auth_failure", { scope: "sign_in", reason: result.error });
  return result;
}

export type PasswordResetResult = { ok: true } | { ok: false; error: "invalid_input" | "unavailable" | "not_configured" };

/**
 * "Forgot password?" — asks Supabase Auth to email a recovery link through the
 * existing flow (the Reset-password email template points at
 * /auth/confirm?…&type=recovery, which continues to /auth/set-password).
 *
 * Anti-enumeration: the answer is the same whether or not an account exists,
 * and Supabase's own rate limit (429) is NOT reported to the browser, since it
 * could differ between existing and unknown addresses. Only a network/service
 * failure is reported. Supabase enforces its email rate limits; nothing here
 * changes a credential, and no token passes through this server.
 */
export async function requestPasswordResetAction(input: { email: string }): Promise<PasswordResetResult> {
  if (!isSupabaseAuthEnabled()) return { ok: false, error: "not_configured" };
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(320) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { email } = parsed.data;

  let reason: string | undefined;
  let result: PasswordResetResult = { ok: true };
  try {
    const supabase = await createSupabaseServerClient();
    // Same rule as sign-up: back to this app's /auth/callback, then the set-password page.
    const redirectTo = authCallbackUrl("/auth/set-password");
    const { error } = redirectTo ? await supabase.auth.resetPasswordForEmail(email, { redirectTo }) : await supabase.auth.resetPasswordForEmail(email);
    if (error) reason = error.status === 429 ? "rate_limited" : "provider_error"; // for operators only, never shown
  } catch {
    reason = "unavailable";
    result = { ok: false, error: "unavailable" };
  }

  await recordAuditEvent({
    action: "auth.password_reset_requested",
    outcome: reason ? "FAILURE" : "SUCCESS",
    // Like sign-in: the requested identifier is visible to operators in the audit trail. Never a token.
    actorLabel: email,
    reason,
  });
  return result;
}

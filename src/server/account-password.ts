import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabasePublicConfig } from "@/lib/auth/config";
import { newPasswordProblem, PASSWORD_MAX } from "@/lib/password-rules";
import type { Identity } from "@/server/auth/authorize";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { recordAuditEvent } from "@/server/audit";
import { logServerError } from "@/server/log";
import { createSupabaseServerClient } from "@/server/supabase";

// Changing your own password: the current password is checked first, on the
// server. It is verified against Supabase Auth on a separate, throwaway
// session (no cookies), which must belong to the signed-in login; only then is
// the new password saved, and every other session is signed out. Each attempt
// is audited (never the passwords). Supabase Auth also rate-limits password
// checks per IP, so repeated guesses are refused.

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(200),
    newPassword: z.string().max(PASSWORD_MAX * 4),
  })
  .strict();

type Verified = Identity & { verifiedEmail: string };

const audit = (identity: Identity, outcome: "SUCCESS" | "FAILURE" | "DENIED", reason?: string) =>
  recordAuditEvent({ action: "auth.password_changed", outcome, reason, actor: { userId: identity.userId, authUserId: identity.authUserId }, targetType: "users", targetId: identity.userId });

export async function changeOwnPassword(identity: Verified, raw: unknown): Promise<{ ok: true; otherSessionsSignedOut: boolean }> {
  const { currentPassword, newPassword } = changePasswordSchema.parse(raw);
  const problem = newPasswordProblem(newPassword, { current: currentPassword, email: identity.verifiedEmail });
  if (problem) throw new DataError("INVALID_INPUT", problem);

  const config = getSupabasePublicConfig();
  if (!config) throw new AuthError("AUTH_NOT_CONFIGURED");

  // 1. Is the current password right? A stateless client: nothing is stored, no cookie is touched.
  const verifier = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await verifier.auth.signInWithPassword({ email: identity.verifiedEmail, password: currentPassword });
  if (error || !data.user) {
    if (error?.status === 429) {
      await audit(identity, "DENIED", "rate_limited");
      throw new DataError("RATE_LIMITED", "Too many attempts. Wait a few minutes, then try again.");
    }
    if (error?.code === "invalid_credentials") {
      await audit(identity, "FAILURE", "wrong_current_password");
      throw new DataError("INVALID_INPUT", "Your current password is incorrect.");
    }
    logServerError("password change: verify", error?.code ?? "no_user");
    throw new DataError("UNAVAILABLE", "Couldn't check your password right now. Please try again.");
  }
  // The checked login must be the one signed in here (never someone else's with the same email).
  const sameLogin = data.user.id === identity.authUserId;
  // End the throwaway session either way.
  await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (!sameLogin) {
    await audit(identity, "DENIED", "login_mismatch");
    throw new AuthError("FORBIDDEN");
  }

  // 2. Save the new password on the signed-in session.
  const supabase = await createSupabaseServerClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    await audit(identity, "FAILURE", updateError.code ?? "update_failed");
    if (updateError.code === "weak_password") throw new DataError("INVALID_INPUT", "That password is too weak. Try a longer one.");
    if (updateError.code === "same_password") throw new DataError("INVALID_INPUT", "The new password must be different from your current one.");
    if (updateError.status === 401 || updateError.code === "session_not_found") throw new AuthError("UNAUTHENTICATED");
    logServerError("password change: update", updateError.code ?? updateError.status);
    throw new DataError("UNAVAILABLE", "Couldn't change your password. Please try again.");
  }

  // 3. Everyone else signed in as you (other browsers, phones) is signed out.
  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) logServerError("password change: sign out others", othersError.code ?? othersError.status);
  await audit(identity, "SUCCESS");
  return { ok: true, otherSessionsSignedOut: !othersError };
}

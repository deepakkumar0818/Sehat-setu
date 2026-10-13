"use server";

import { z } from "zod";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/server/supabase";
import { recordAuditEvent } from "@/server/audit";

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
  return result;
}

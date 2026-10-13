import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig, parseSupabasePublicConfig } from "@/lib/auth/config";

// Server-only Supabase Auth admin access, used for exactly one thing: emailing
// staff invitations. The secret key is read from SUPABASE_SECRET_KEY (a
// server-only variable — never NEXT_PUBLIC_*), is never logged, and never
// leaves this module. `import "server-only"` makes any client-side import fail
// the build.
//
// Privacy: invitations go to new addresses with inviteUserByEmail(). When the
// address already has an account, Supabase refuses the invite; we then send a
// generic sign-in link (signInWithOtp, shouldCreateUser: false) instead. Both
// paths report the same "sent" result, so nobody learns whether an account
// existed. No clinic, role or other data is passed into the email or into the
// user's Auth metadata — the templates are generic.

/**
 * Machine-readable delivery failure codes (stored on the invitation; no provider text).
 * - not_configured: this server has no usable SUPABASE_SECRET_KEY (or public Supabase config) — nothing was sent.
 * - key_rejected:   Supabase refused the server's key (wrong project, revoked, or not a secret key).
 * - email_disabled: the Email provider is turned off in the Supabase project.
 * - send_failed:    Supabase accepted the request but its mail step failed (SMTP settings or email template).
 * - rate_limited / unavailable / not_authorized / provider_error: as named.
 */
export type DeliveryErrorCode =
  | "not_configured"
  | "key_rejected"
  | "email_disabled"
  | "send_failed"
  | "rate_limited"
  | "unavailable"
  | "not_authorized"
  | "provider_error";

export type DeliveryResult = { ok: true } | { ok: false; error: DeliveryErrorCode };

type SupabaseAuthError = { code?: string; status?: number; name?: string } | null | undefined;

/** The minimal Supabase calls the sender needs (injectable for tests). */
export interface InvitationMailer {
  invite(email: string): Promise<{ error: SupabaseAuthError }>;
  signInLink(email: string): Promise<{ error: SupabaseAuthError }>;
}

/** Validates the secret key's shape without revealing it. Null = not usable. */
export function readSecretKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!key || /\[|\]|your-|<|>/i.test(key)) return null;
  // A publishable key here would fail every admin call; refuse it explicitly.
  if (key.startsWith("sb_publishable_") || key === env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) return null;
  return key;
}

/**
 * Why invitation email can't be sent from this server, naming the setting (never
 * its value) — or null when it's configured. Shown to operators in the server log.
 */
export function mailerConfigProblem(env: Record<string, string | undefined> = process.env): string | null {
  if (!parseSupabasePublicConfig({ url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY })) {
    return "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are missing or invalid";
  }
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return "SUPABASE_SECRET_KEY is not set in the server environment (.env.local)";
  if (readSecretKey(env)) return null;
  if (key.startsWith("sb_publishable_") || key === env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    return "SUPABASE_SECRET_KEY holds the publishable key; it needs the project's secret key (sb_secret_...)";
  }
  return "SUPABASE_SECRET_KEY still holds a placeholder value";
}

/** True when this server can email invitations (used to disable Resend instead of wasting attempts). */
export const emailSendingConfigured = () => mailerConfigProblem() === null;

let warnedProblem: string | null = null;

/** The real mailer, or null when the server isn't configured for it. */
export function createSupabaseMailer(): InvitationMailer | null {
  const config = getSupabasePublicConfig();
  const secret = readSecretKey();
  if (!config || !secret) {
    const problem = mailerConfigProblem() ?? "the public Supabase configuration is invalid";
    if (problem !== warnedProblem) {
      warnedProblem = problem;
      console.warn(`[invitations] email sending is not configured: ${problem}. Invitations are saved; resend once it's set and the server restarted.`);
    }
    return null;
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
  const admin = createClient(config.url, secret, options);
  const publicClient = createClient(config.url, config.publishableKey, options);
  return {
    invite: async (email) => ({ error: (await admin.auth.admin.inviteUserByEmail(email)).error }),
    signInLink: async (email) => ({ error: (await publicClient.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })).error }),
  };
}

const EXISTING_ACCOUNT = new Set(["email_exists", "user_already_exists"]);

const KEY_REJECTED = new Set(["bad_jwt", "not_admin", "no_authorization", "invalid_api_key"]);

function toErrorCode(error: NonNullable<SupabaseAuthError>): DeliveryErrorCode {
  const status = error.status ?? 0;
  if (status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return "rate_limited";
  if (error.code === "email_address_not_authorized") return "not_authorized";
  if (error.code === "email_provider_disabled" || error.code === "signup_disabled") return "email_disabled";
  if (status === 401 || status === 403 || KEY_REJECTED.has(error.code ?? "")) return "key_rejected";
  // Network failure, timeout, or a gateway error: retrying later may work.
  if (error.name === "AuthRetryableFetchError" || error.code === "request_timeout" || status === 502 || status === 503 || status === 504) return "unavailable";
  // Supabase Auth answers 500 when its own mail step fails (SMTP settings or template).
  if (status >= 500) return "send_failed";
  return "provider_error";
}

/**
 * Emails one invitation. Never throws; returns a delivery code instead.
 * "ok" means the email provider accepted the message — not that anyone
 * received it, and certainly not that the invitation was accepted.
 */
export async function sendInvitationEmail(email: string, mailer: InvitationMailer | null = createSupabaseMailer()): Promise<DeliveryResult> {
  if (!mailer) return { ok: false, error: "not_configured" };
  try {
    const invited = await mailer.invite(email);
    if (!invited.error) return { ok: true };
    const existing = EXISTING_ACCOUNT.has(invited.error.code ?? "") || (invited.error.status === 422 && !invited.error.code);
    if (!existing) return { ok: false, error: toErrorCode(invited.error) };
    // Existing account: a generic sign-in link, reported exactly like an invite.
    const link = await mailer.signInLink(email);
    return link.error ? { ok: false, error: toErrorCode(link.error) } : { ok: true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

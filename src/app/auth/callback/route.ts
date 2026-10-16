import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/server/supabase";

// Where Supabase email links land when the app passes a redirect (sign-up
// confirmation, password recovery; see src/lib/auth/site-url.ts). Supports:
//   * ?code=…            PKCE: Supabase verified the link, then redirected here
//                        with a one-time code; exchanged (with the code
//                        verifier cookie set at sign-up) for a session cookie.
//   * ?token_hash=…&type= a template that links straight here (works in any
//                        browser): verified with verifyOtp, like /auth/confirm.
//   * ?error=…&error_code= Supabase's answer for an expired or already-used link.
// Then continues to `next` (same-origin paths only; default /link-account,
// where a confirmed patient enters the clinic's linking code or, if new,
// gets their record created). Codes and tokens are never logged or forwarded: every
// response is a redirect to a clean URL.

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];
const CODE = /^[A-Za-z0-9_-]{8,512}$/;
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,512}$/;

function go(request: NextRequest, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, request.url));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function failure(next: string, expired: boolean): string {
  // A recovery link has nothing to "sign in" to: ask for a new one.
  if (next.startsWith("/auth/set-password")) return "/login?reason=reset_link_invalid";
  return `/login?reason=${expired ? "link_expired" : "link_invalid"}&next=${encodeURIComponent(next)}`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/link-account");
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  // Supabase couldn't verify the link (expired, already used, or invalid).
  const errorCode = params.get("error_code") ?? params.get("error");
  if (errorCode) return go(request, failure(next, errorCode === "otp_expired"));

  if (!(code && CODE.test(code)) && !(tokenHash && TOKEN_HASH.test(tokenHash) && type && OTP_TYPES.includes(type))) {
    return go(request, failure(next, false)); // missing or malformed parameters
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return go(request, "/login?reason=link_invalid");
  }

  try {
    if (code && CODE.test(code)) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return go(request, next);
      // Supabase only issues a code after verifying the email, so the address
      // IS confirmed; this browser just couldn't get a session (opened in
      // another browser, opened twice, or the code timed out). If a session
      // already exists, carry on; otherwise ask the user to sign in.
      const { data } = await supabase.auth.getUser();
      if (data.user?.email_confirmed_at) return go(request, next);
      if (next.startsWith("/auth/set-password")) return go(request, "/login?reason=reset_link_invalid");
      return go(request, `/login?reason=email_confirmed&next=${encodeURIComponent(next)}`);
    }
    const { error } = await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });
    if (!error) return go(request, next);
    return go(request, failure(next, error.code === "otp_expired"));
  } catch {
    return go(request, failure(next, false));
  }
}

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/server/supabase";

const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "signup", "magiclink", "email_change"];

/**
 * Landing route for Supabase email links (invitation, password recovery).
 * Exchanges the one-time token for a session cookie, then continues to `next`
 * — e.g. /auth/set-password for a new invitee. Requires the Supabase email
 * templates to link here (see docs/security.md).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallbackNext = type === "invite" || type === "recovery" ? "/auth/set-password" : "/dashboard";
  const next = safeNextPath(searchParams.get("next"), fallbackNext);

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    } catch {
      // fall through to the error redirect
    }
  }
  return NextResponse.redirect(new URL("/login?reason=link_invalid", request.url));
}

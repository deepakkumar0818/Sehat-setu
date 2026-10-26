import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/server/supabase";
import { ACTIVE_CLINIC_COOKIE, forgetVerifiedSessions } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit";

/** POST-only so a stray link or prefetch can't sign someone out. Clears the Supabase session cookies server-side. */
export async function POST(request: NextRequest) {
  if (isSupabaseAuthEnabled()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    await supabase.auth.signOut();
    if (data.user) forgetVerifiedSessions(data.user.id);
    if (data.user) await recordAuditEvent({ action: "auth.sign_out", outcome: "SUCCESS", actor: { authUserId: data.user.id } });
  }
  const response = NextResponse.redirect(new URL("/login?reason=signed_out", request.url), { status: 303 });
  response.cookies.delete(ACTIVE_CLINIC_COOKIE);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

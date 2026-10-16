import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import type { UserRole } from "@/types";

/**
 * "Reset demo data" regenerates the browser-only demo dataset (localStorage).
 * Allowed only in demo mode (no Supabase Auth) and never for patients. With
 * real sign-in there is nothing in the browser to reset, and no server
 * endpoint exists for it — clinic data can't be reset from the app.
 */
export function canResetDemoData(role: UserRole | undefined, authEnabled: boolean = isSupabaseAuthEnabled()): boolean {
  return !authEnabled && role !== undefined && role !== "patient";
}

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/auth/config";

/**
 * Browser Supabase client — for sign-in, sign-out, and password updates only.
 * It holds the user's session in cookies so the server can verify it; the
 * browser never decides identity, role, clinic, or permissions, and never
 * reads clinic data through it (the Data API is locked down for this app).
 */
export function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase Auth is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
  return createBrowserClient(config.url, config.publishableKey);
}

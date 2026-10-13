import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/auth/config";
import { AuthError } from "@/server/auth/errors";

/**
 * A Supabase client bound to the current request's cookies. Create one per
 * request — never share it. Server Components can't write cookies, so token
 * refreshes there are dropped silently; the proxy (src/proxy.ts) refreshes
 * the session before rendering, and Route Handlers / Server Actions can write.
 */
export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new AuthError("AUTH_NOT_CONFIGURED");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there.
        }
      },
    },
  });
}

/** Whether the request carries a Supabase session cookie (used to tell "expired" from "never signed in"). */
export async function hasSupabaseSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

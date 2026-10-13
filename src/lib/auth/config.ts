// Supabase Auth configuration — the PUBLIC half only (project URL and
// publishable key are designed to be shipped to browsers). Safe to import from
// client components, the proxy, and server code alike.
//
// When this returns null the app runs in "demo mode": the original client-side
// persona login keeps working for the fictional mock data, but every
// server-side database helper refuses to run (see src/server/auth/session.ts).

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

interface RawEnv {
  url?: string;
  publishableKey?: string;
}

const PLACEHOLDER = /\[|\]|your-|<|>/i;

/** Pure parser, exported for tests. Rejects missing, placeholder, or non-HTTPS (except localhost) values. */
export function parseSupabasePublicConfig(raw: RawEnv): SupabasePublicConfig | null {
  const url = raw.url?.trim();
  const publishableKey = raw.publishableKey?.trim();
  if (!url || !publishableKey || PLACEHOLDER.test(url) || PLACEHOLDER.test(publishableKey)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) return null;
  return { url: parsed.origin, publishableKey };
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  // Each variable must be referenced literally so Next.js can inline it into client bundles.
  return parseSupabasePublicConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** True when real Supabase authentication is active (and the demo persona login is disabled). */
export function isSupabaseAuthEnabled(): boolean {
  return getSupabasePublicConfig() !== null;
}

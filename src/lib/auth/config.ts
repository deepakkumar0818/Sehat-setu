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

/** Set to "true" only for a deliberate demo deployment (fictional data, no database). */
export const ALLOW_DEMO_BUILD_ENV = "SEHAT_ALLOW_DEMO_BUILD";

/**
 * Why a production build must stop, or null. The public Supabase values are
 * inlined into the bundles at build time, so a build without them would ship
 * the demo-persona login and mock data instead of failing: production builds
 * therefore require them, unless a demo deployment is explicitly intended.
 */
export function productionAuthConfigProblem(env: Record<string, string | undefined>): string | null {
  const config = parseSupabasePublicConfig({ url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
  if (config || env[ALLOW_DEMO_BUILD_ENV] === "true") return null;
  return (
    "Refusing to build for production without Supabase Auth: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
    "are missing or invalid, so the app would silently run in demo mode. Set them, or set " +
    `${ALLOW_DEMO_BUILD_ENV}=true for an intentional demo deployment.`
  );
}

/** True when real Supabase authentication is active (and the demo persona login is disabled). */
export function isSupabaseAuthEnabled(): boolean {
  return getSupabasePublicConfig() !== null;
}

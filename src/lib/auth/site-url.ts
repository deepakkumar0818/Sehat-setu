// The one place that decides this app's public origin for Supabase email links
// (sign-up confirmation, password recovery). Supabase builds those links from
// the `redirectTo` / `emailRedirectTo` we pass; without one it falls back to
// the dashboard's Site URL — which, for the development project, pointed at a
// deleted Vercel deployment (404 DEPLOYMENT_NOT_FOUND).
//
//   * Development (anything but NODE_ENV=production): NEXT_PUBLIC_APP_URL if it
//     is a localhost / 127.0.0.1 origin, otherwise http://localhost:3000. A
//     Vercel (or any other remote) URL is never used locally, and VERCEL_URL is
//     ignored everywhere.
//   * Production: NEXT_PUBLIC_APP_URL only if it is an explicit https origin;
//     otherwise null, and callers pass no redirect (Supabase's Site URL, as
//     before). localhost is never used in production.
//
// The redirect must also be on the Supabase project's Redirect URLs allowlist
// (Authentication → URL Configuration), e.g. http://localhost:3000/** — see
// docs/security.md.

export const LOCAL_SITE_URL = "http://localhost:3000";
export const AUTH_CALLBACK_PATH = "/auth/callback";

type Env = Record<string, string | undefined>;

function originOf(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    // An origin only: no credentials, path, query or fragment.
    if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** This app's public origin for email links, or null to let Supabase use its Site URL (production without configuration). */
export function getSiteUrl(env: Env = process.env): string | null {
  const configured = originOf(env.NEXT_PUBLIC_APP_URL);
  if (env.NODE_ENV === "production") {
    return configured && configured.protocol === "https:" && !LOCAL_HOSTS.has(configured.hostname) ? configured.origin : null;
  }
  return configured && configured.protocol === "http:" && LOCAL_HOSTS.has(configured.hostname) ? configured.origin : LOCAL_SITE_URL;
}

/**
 * The absolute URL of the email-link callback, continuing to `next` (a
 * same-origin path) after the session is established. Null when no site URL
 * is configured (production): then no redirect is sent.
 */
export function authCallbackUrl(next: string, env: Env = process.env): string | null {
  const site = getSiteUrl(env);
  if (!site) return null;
  const url = new URL(AUTH_CALLBACK_PATH, site);
  url.searchParams.set("next", next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return url.toString();
}

// Verified TLS for every PostgreSQL connection made through the `pg` driver
// (the app's Prisma adapter, the seed and the admin scripts).
//
// Supabase's poolers present a chain ending in "Supabase Root 2021 CA", which
// isn't in the standard trust store, so we pin that CA. Verification is never
// disabled: an invalid CA throws, and connections fail closed. There is no
// "skip certificate checks" fallback, by design.
//
// The CA is embedded (src/server/db/supabase-root-ca.ts — a public
// certificate), so the server needs no filesystem access. DATABASE_CA_CERT
// (PEM text) overrides it, e.g. after Supabase rotates its CA. The Prisma CLI
// reads the same certificate from certs/supabase-root-2021-ca.crt.
// No server-only import: shared with CLI scripts under prisma/.
import type { ConnectionOptions } from "node:tls";
import { SUPABASE_ROOT_2021_CA } from "./supabase-root-ca";

const SSL_URL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "sslaccept"];

export function loadDatabaseCa(env: Record<string, string | undefined> = process.env): string {
  const inline = env.DATABASE_CA_CERT?.trim();
  if (!inline) return SUPABASE_ROOT_2021_CA;
  const pem = inline.replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN CERTIFICATE-----") || !pem.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT must be a PEM certificate. Connections are refused without a valid CA.");
  }
  return pem;
}

/**
 * pg connection settings with certificate AND hostname verification. Rejects
 * connection strings carrying their own ssl parameters, because pg lets those
 * override the `ssl` object (which could silently weaken verification).
 */
export function verifiedPgConfig(connectionString: string, env: Record<string, string | undefined> = process.env): { connectionString: string; ssl: ConnectionOptions } {
  const url = new URL(connectionString);
  const conflicting = SSL_URL_PARAMS.filter((p) => url.searchParams.has(p));
  if (conflicting.length) {
    throw new Error(`Remove ${conflicting.join(", ")} from the database URL — TLS is configured in src/server/db/tls.ts.`);
  }
  return { connectionString, ssl: { ca: loadDatabaseCa(env), rejectUnauthorized: true } };
}

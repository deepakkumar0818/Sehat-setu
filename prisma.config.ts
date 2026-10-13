import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7's CLI no longer loads env files on its own. Load them with the same
// precedence Next.js uses (.env.local wins over .env); existing process env
// vars (e.g. set by CI or the hosting provider) are never overridden.
config({ path: [".env.local", ".env"], quiet: true });

/**
 * DIRECT_URL with verified TLS for the Prisma CLI's engine: sslmode=require +
 * the pinned Supabase root CA + sslaccept=strict (certificate and hostname
 * checks). The app and scripts use src/server/db/tls.ts for the same CA.
 */
function cliDatasourceUrl(): string | undefined {
  const raw = process.env.DIRECT_URL;
  if (!raw) return undefined; // `prisma generate` doesn't need a database
  const url = new URL(raw);
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("sslcert", path.resolve(process.env.DATABASE_CA_CERT_PATH || "certs/supabase-root-2021-ca.crt"));
  url.searchParams.set("sslaccept", "strict");
  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `npm run db:seed` (prisma db seed) runs this; see prisma/seed.ts.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and introspection need a session-level connection, so the CLI
    // uses Supabase's session-mode pooler (port 5432) as the postgres role —
    // never the runtime role. Read via process.env rather than prisma's env()
    // helper so `prisma generate` still works where no DB URL is set (CI).
    url: cliDatasourceUrl(),
  },
});

// Shared connection setup for the seed and db-status scripts (CLI-only — the
// Next.js app uses src/server/prisma.ts instead).
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { verifiedPgConfig } from "../../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * A client on the session-mode connection (DIRECT_URL), which suits one-off
 * admin scripts and long transactions. Throws, without echoing the URL, if the
 * password placeholder from .env.example / .env.local is still in place.
 */
export function createScriptClient(): PrismaClient {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL (or DATABASE_URL) is not set. Add it to .env.local.");
  }
  if (connectionString.includes("[YOUR-PASSWORD]")) {
    throw new Error("The database password in .env.local is still the [YOUR-PASSWORD] placeholder. Replace it locally, then retry.");
  }
  // Verified TLS (pinned Supabase CA, hostname check) — same as the app.
  return new PrismaClient({ adapter: new PrismaPg(verifiedPgConfig(connectionString)) });
}

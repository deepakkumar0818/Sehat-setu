import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { verifiedPgConfig } from "@/server/db/tls";

// The app's one database client. Like send-account-notifications.ts, this is
// server-only (the import above fails the build if a client component pulls
// it in), and its connection string comes from a non-NEXT_PUBLIC_ env var.
//
// Connects as the least-privileged `sehat_app` role (DATABASE_URL) through
// Supabase's transaction-mode pooler, with TLS certificate and hostname
// verification against the pinned Supabase CA (src/server/db/tls.ts). That
// role has no BYPASSRLS, so Row-Level Security applies to every query.

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  }
  // Every query runs in an interactive transaction (src/server/db/tenant.ts).
  // Prisma's default maxWait (2s) covers acquiring a pooled connection AND
  // BEGIN; a fresh TLS connection to the remote pooler alone takes ~0.5–0.8s,
  // so a page firing several transactions on a cold or busy pool exceeded it
  // ("Unable to start a transaction in the given time"). connectionTimeoutMillis
  // still fails fast if the database is actually unreachable.
  return new PrismaClient({
    adapter: new PrismaPg({ ...verifiedPgConfig(connectionString), max: 20, connectionTimeoutMillis: 10_000 }),
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}

// Next.js dev hot-reloads modules; cache the client on globalThis so each
// reload reuses one connection pool instead of opening a new one.
//
// Reuse it only if it was created from the CURRENT generated client class.
// After `prisma generate` (e.g. a migration adding models), the reloaded
// module brings a new PrismaClient class; a client cached from before would
// lack the new model delegates (tx.inventoryItem was undefined → 500s on
// /api/v1/inventory). Such a stale client is replaced and its pool closed.
// The class is stored alongside the client and compared by reference
// (`instanceof` doesn't work: Prisma's constructor returns an extension proxy).
const globalForPrisma = globalThis as unknown as { prisma?: unknown; prismaClass?: unknown };
const cached = globalForPrisma.prismaClass === PrismaClient ? (globalForPrisma.prisma as PrismaClient | undefined) : undefined;

export const prisma: PrismaClient = cached ?? createPrismaClient();

const stale = globalForPrisma.prisma;
if (stale && stale !== prisma) {
  void (stale as { $disconnect?: () => Promise<void> }).$disconnect?.().catch(() => undefined);
}
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClass = PrismaClient;
}

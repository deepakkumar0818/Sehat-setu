import { afterEach, describe, expect, it, vi } from "vitest";

// Regression test for the inventory 500s: in dev, src/server/prisma.ts caches
// the client on globalThis across hot reloads. A client cached before
// `prisma generate` added models had no tx.inventoryItem. The module must
// replace a cached client that wasn't created from the current generated class.

const g = globalThis as unknown as { prisma?: unknown; prismaClass?: unknown };

afterEach(async () => {
  const current = g.prisma as { $disconnect?: () => Promise<void> } | undefined;
  await current?.$disconnect?.();
  delete g.prisma;
  delete g.prismaClass;
  vi.resetModules();
});

describe("Prisma client cache", () => {
  it("replaces a stale cached client (from an older generated class) and closes it", async () => {
    const disconnect = vi.fn(async () => undefined);
    const stale = { $disconnect: disconnect }; // like a client from before the inventory models: no inventoryItem
    g.prisma = stale;
    g.prismaClass = class OldGeneratedPrismaClient {}; // the class an earlier `prisma generate` produced
    vi.resetModules();
    const { prisma } = await import("./prisma");
    const { PrismaClient } = await import("@/generated/prisma/client");
    // Booleans, not the clients themselves: vitest can't pretty-print Prisma's proxies.
    expect(prisma === (stale as unknown)).toBe(false);
    expect(g.prismaClass === PrismaClient).toBe(true);
    expect(typeof prisma.inventoryItem.findMany).toBe("function");
    expect(typeof prisma.inventoryReorderLevel.findMany).toBe("function");
    expect(typeof prisma.stockMovement.findMany).toBe("function");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(g.prisma === prisma).toBe(true);
  });

  it("reuses a cached client of the current class (one connection pool across reloads)", async () => {
    vi.resetModules();
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { verifiedPgConfig } = await import("./db/tls");
    const current = new PrismaClient({ adapter: new PrismaPg(verifiedPgConfig(process.env.DATABASE_URL!)) });
    g.prisma = current;
    g.prismaClass = PrismaClient;
    const { prisma } = await import("./prisma"); // same module graph, so the same generated class
    expect(prisma === current).toBe(true);
  });
});

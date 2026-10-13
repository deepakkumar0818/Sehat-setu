import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { adminClient, contextFor, FIX } from "@/test/live-fixtures";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";

// Regression tests for GET /api/v1/inventory and GET /api/v1/inventory/summary
// (which returned 500 when the dev server held a Prisma client generated before
// the inventory models existed). The route handlers run for real — apiRoute,
// the data module, and the live database as sehat_app under RLS. Only the
// session lookup is replaced: it returns a fixture user's verified context (or
// throws UNAUTHENTICATED), and applies the route's permission exactly as
// requireStaff does. Read-only: no stock data is created.

let signedIn: TenantContext | null = null;
vi.mock("@/server/auth/session", () => ({
  requireStaff: async (permission: string | readonly string[]) => {
    if (!signedIn) throw new AuthError("UNAUTHENTICATED");
    requirePermission(signedIn, permission);
    return signedIn;
  },
}));

const { GET: listGET } = await import("./route");
const { GET: summaryGET } = await import("./summary/route");

let admin: Client;
let adminA: TenantContext;
let managerWakad: TenantContext;
let receptionWakad: TenantContext;

const call = async (handler: typeof listGET, url: string) => {
  const res = await handler(new NextRequest(new URL(url, "http://localhost:3000")), { params: Promise.resolve({}) });
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
};

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
});

afterAll(async () => {
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("GET /api/v1/inventory", () => {
  it("returns 401 when signed out", async () => {
    signedIn = null;
    const res = await call(listGET, "/api/v1/inventory?status=all&branchId=all&page=1&pageSize=12");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the stock page for an administrator (200, matches the database)", async () => {
    signedIn = adminA;
    const res = await call(listGET, "/api/v1/inventory?status=all&branchId=all&page=1&pageSize=12");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 12 });
    expect(Array.isArray(res.body.items)).toBe(true);
    const groups = Number((await admin.query(`SELECT count(*) n FROM (SELECT DISTINCT "branchId", "medicineId" FROM inventory_items WHERE "clinicId" = $1
      UNION SELECT "branchId", "medicineId" FROM inventory_reorder_levels WHERE "clinicId" = $1) g`, [FIX.clinicA])).rows[0].n);
    expect(res.body.total).toBe(groups); // an empty inventory is a legitimate empty page, not an error
    expect(res.cache).toBe("private, no-store");
  });

  it("returns 200 for a view-only clinic manager, limited to their branch", async () => {
    signedIn = managerWakad;
    const res = await call(listGET, "/api/v1/inventory?page=1&pageSize=12");
    expect(res.status).toBe(200);
    expect(res.body.items.every((r: { branchId: string }) => r.branchId === FIX.wakad)).toBe(true);
    expect((await call(listGET, `/api/v1/inventory?branchId=${FIX.kothrud}`)).status).toBe(403);
  });

  it("returns 403 for a role without inventory access, and 400 for bad filters", async () => {
    signedIn = receptionWakad;
    expect((await call(listGET, "/api/v1/inventory")).status).toBe(403);
    signedIn = adminA;
    expect((await call(listGET, "/api/v1/inventory?status=bogus")).status).toBe(400);
  });
});

describe("GET /api/v1/inventory/summary", () => {
  it("returns 401 when signed out", async () => {
    signedIn = null;
    const res = await call(summaryGET, "/api/v1/inventory/summary");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns counts and the manage hint for an administrator", async () => {
    signedIn = adminA;
    const res = await call(summaryGET, "/api/v1/inventory/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: expect.any(Number),
      lowStock: expect.any(Number),
      outOfStock: expect.any(Number),
      expiringSoon: expect.any(Number),
      expired: expect.any(Number),
      canManage: true,
    });
  });

  it("returns view-only counts for a clinic manager and 403 without permission", async () => {
    signedIn = managerWakad;
    const res = await call(summaryGET, "/api/v1/inventory/summary");
    expect(res.status).toBe(200);
    expect(res.body.canManage).toBe(false);
    signedIn = receptionWakad;
    expect((await call(summaryGET, "/api/v1/inventory/summary")).status).toBe(403);
  });
});

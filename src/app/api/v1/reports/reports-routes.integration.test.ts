import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, istDate } from "@/test/live-fixtures";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";

// The report routes through apiRoute/fileRoute and the real data module, as
// fixture users. Only the session lookup is replaced. Nothing is written: a
// successful export would commit an audit event, so exports are exercised
// here only where they are refused (the audited success path is covered,
// rolled back, in src/server/data/reports.integration.test.ts).

let signedIn: TenantContext | null = null;
vi.mock("@/server/auth/session", () => ({
  requireStaff: async (permission: string | readonly string[]) => {
    if (!signedIn) throw new AuthError("UNAUTHENTICATED");
    requirePermission(signedIn, permission);
    return signedIn;
  },
  requireIdentity: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
  ACTIVE_CLINIC_COOKIE: "sehat_active_clinic",
}));

const operationalRoute = await import("./operational/route");
const financialRoute = await import("./financial/route");
const exportRoute = await import("./export/route");
const { fileRoute } = await import("@/server/api/route-handler");

let admin: Client;
let adminA: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;
let auditBefore: number;

const RANGE = `from=${istDate(-30)}&to=${istDate(0)}`;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(handler: Handler, url: string) {
  const res = await handler(new NextRequest(new URL(url, "http://localhost:3000")), { params: Promise.resolve({}) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // CSV
  }
  return { status: res.status, headers: res.headers, body: body as { error?: { code: string; message: string } } & Record<string, unknown> };
}

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  doctor1 = await contextFor(admin, "DR-01");
  auditBefore = Number((await admin.query(`SELECT count(*) n FROM audit_events`)).rows[0].n);
});

afterAll(async () => {
  expect(Number((await admin.query(`SELECT count(*) n FROM audit_events`)).rows[0].n)).toBe(auditBefore); // nothing exported or written
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("report routes", () => {
  it("401 without a session", async () => {
    signedIn = null;
    expect((await call(operationalRoute.GET, `/api/v1/reports/operational?${RANGE}`)).status).toBe(401);
    expect((await call(exportRoute.GET, `/api/v1/reports/export?report=appointments&${RANGE}`)).status).toBe(401);
  });

  it("administrators get live operational and financial figures, never cached", async () => {
    signedIn = adminA;
    const op = await call(operationalRoute.GET, `/api/v1/reports/operational?${RANGE}`);
    expect(op.status).toBe(200);
    expect(op.headers.get("cache-control")).toBe("private, no-store");
    expect(op.body).toMatchObject({ scope: { canExport: true, canViewFinancial: true }, unavailable: [] });
    const fin = await call(financialRoute.GET, `/api/v1/reports/financial?${RANGE}`);
    expect(fin.status).toBe(200);
    expect(fin.body).toHaveProperty("collections.netPaise");
  });

  it("403 for roles without reports.view, and for exports without reports.export", async () => {
    for (const ctx of [receptionWakad, doctor1]) {
      signedIn = ctx;
      for (const [route, url] of [[operationalRoute.GET, "operational"], [financialRoute.GET, "financial"], [exportRoute.GET, "export?report=collections&"]] as const) {
        const r = await call(route, `/api/v1/reports/${url}${url.endsWith("&") ? "" : "?"}${RANGE}`);
        expect(r.status, `${ctx.email} ${url}`).toBe(403);
        expect(r.body.error?.code).toBe("FORBIDDEN");
      }
    }
    signedIn = managerWakad; // reports.view but not reports.export
    const r = await call(exportRoute.GET, `/api/v1/reports/export?report=appointments&${RANGE}`);
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toContain("application/json"); // an error, not a file
  });

  it("branch scope: a Wakad manager gets 403 for Kothrud and Wakad figures otherwise", async () => {
    signedIn = managerWakad;
    const own = await call(operationalRoute.GET, `/api/v1/reports/operational?${RANGE}`);
    expect(own.body).toMatchObject({ scope: { branchId: FIX.wakad, branchLocked: true, canExport: false } });
    const other = await call(financialRoute.GET, `/api/v1/reports/financial?${RANGE}&branchId=${FIX.kothrud}`);
    expect(other.status).toBe(403);
    expect(other.body.error?.code).toBe("BRANCH_FORBIDDEN");
  });

  it("400 for invalid ranges and filters, with a readable message", async () => {
    signedIn = adminA;
    const reversed = await call(operationalRoute.GET, `/api/v1/reports/operational?from=2026-10-10&to=2026-10-01`);
    expect(reversed).toMatchObject({ status: 400, body: { error: { code: "INVALID_INPUT", message: "The start date must be on or before the end date." } } });
    expect((await call(operationalRoute.GET, `/api/v1/reports/operational?from=2024-01-01&to=2026-01-01`)).status).toBe(400);
    expect((await call(operationalRoute.GET, `/api/v1/reports/operational?${RANGE}&branchId=x`)).status).toBe(400);
    expect((await call(exportRoute.GET, `/api/v1/reports/export?report=patients_with_names&${RANGE}`)).status).toBe(400);
  });
});

describe("fileRoute", () => {
  it("serves a download with safe headers, and still returns JSON errors", async () => {
    signedIn = adminA;
    const ok = fileRoute({ permission: "reports.view", resource: "test" }, async () => ({ filename: 'bad "name"/..\\x.csv', contentType: "text/csv; charset=utf-8", body: "\uFEFFa,b\r\n" }));
    const res = await ok(new NextRequest("http://localhost:3000/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="bad__name__.._x.csv"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // Response.text() drops a leading byte-order mark, so check the bytes: UTF-8 BOM, then the CSV.
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b\r\n")]);
    const denied = fileRoute({ permission: "nobody.has.this", resource: "test" }, async () => ({ filename: "x.csv", contentType: "text/csv", body: "" }));
    const d = await denied(new NextRequest("http://localhost:3000/x"), { params: Promise.resolve({}) });
    expect(d.status).toBe(403);
    expect(await d.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

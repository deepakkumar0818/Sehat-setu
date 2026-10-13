import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { adminClient, contextFor } from "@/test/live-fixtures";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";

// GET/POST /api/v1/medicines through the real route handlers (apiRoute, data
// module, live database as sehat_app). Only the session lookup is replaced: it
// returns a fixture user's verified context and applies the route's permission
// as requireStaff does. Nothing is written: POST cases here are refused before
// any insert (signed out, forbidden, invalid, or a duplicate found by the
// pre-check). Successful creation is covered by the rolled-back tests in
// src/server/data/medicines.integration.test.ts.

let signedIn: TenantContext | null = null;
vi.mock("@/server/auth/session", () => ({
  requireStaff: async (permission: string | readonly string[]) => {
    if (!signedIn) throw new AuthError("UNAUTHENTICATED");
    requirePermission(signedIn, permission);
    return signedIn;
  },
}));

const { GET, POST } = await import("./route");

let admin: Client;
let adminA: TenantContext;
let managerWakad: TenantContext;
let receptionWakad: TenantContext;
let doctor1: TenantContext;
let medicineCount = 0;

const get = async (qs = "") => {
  const res = await GET(new NextRequest(new URL(`/api/v1/medicines${qs}`, "http://localhost:3000")), { params: Promise.resolve({}) });
  return { status: res.status, body: await res.json() };
};
const post = async (body: unknown) => {
  const res = await POST(
    new NextRequest(new URL("/api/v1/medicines", "http://localhost:3000"), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    { params: Promise.resolve({}) }
  );
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  doctor1 = await contextFor(admin, "DR-01");
  medicineCount = Number((await admin.query(`SELECT count(*) n FROM medicines`)).rows[0].n);
});

afterAll(async () => {
  expect(Number((await admin.query(`SELECT count(*) n FROM medicines`)).rows[0].n)).toBe(medicineCount);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("GET /api/v1/medicines", () => {
  it("401 signed out, 403 without a catalogue permission", async () => {
    signedIn = null;
    expect((await get()).status).toBe(401);
    signedIn = receptionWakad;
    expect((await get()).status).toBe(403);
  });

  it("200 with a bounded page and the create hint", async () => {
    signedIn = adminA;
    const res = await get("?search=para&page=1&pageSize=500");
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.canCreate).toBe(true);
    expect(res.body.items.every((m: { name: string; genericName: string }) => /para/i.test(m.name + m.genericName))).toBe(true);
    signedIn = doctor1;
    expect((await get()).body.canCreate).toBe(false);
    signedIn = managerWakad;
    expect((await get()).body.canCreate).toBe(false);
  });

  it("400 for invalid paging", async () => {
    signedIn = adminA;
    expect((await get("?page=0")).status).toBe(400);
  });
});

describe("POST /api/v1/medicines", () => {
  const body = { name: "ZZTEST Route", genericName: "Zzroute", strength: "1 mg", dosageForm: "tablet" };

  it("401 signed out; 403 for every non-administrator role", async () => {
    signedIn = null;
    expect((await post(body)).status).toBe(401);
    for (const ctx of [managerWakad, receptionWakad, doctor1]) {
      signedIn = ctx;
      const res = await post(body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("400 for invalid input (unknown form, missing field, extra field)", async () => {
    signedIn = adminA;
    for (const bad of [{ ...body, dosageForm: "spray" }, { ...body, genericName: undefined }, { ...body, manufacturer: "X" }]) {
      const res = await post(bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    }
  });

  it("409 DUPLICATE with the existing entry for a normalised duplicate of a seeded medicine", async () => {
    signedIn = adminA;
    const existing = (await admin.query(`SELECT id, name, strength, "dosageForm"::text f FROM medicines ORDER BY name LIMIT 1`)).rows[0];
    const res = await post({ name: `  ${existing.name.toUpperCase()} `, genericName: "Anything", strength: existing.strength.replace(/\s+/g, ""), dosageForm: existing.f.toLowerCase() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE");
    expect(res.body.error.details.existing.id).toBe(existing.id);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, istDate } from "@/test/live-fixtures";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";

// The CSV export route end to end: GET /api/v1/reports/export through the real
// fileRoute, permission checks, exportReport, SQL under RLS as the runtime role,
// and the real app.log_event audit write. Two things are replaced:
//   1. the session lookup (fixture users can't sign in), and
//   2. withTenantDb, by a rollback harness: each request's transaction is
//      pinned exactly as in production, the audit events it wrote are read back
//      inside it, and then it is ROLLED BACK. No audit event or other row is
//      committed (checked in afterAll against the admin connection).

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

type AuditRow = { actorUserId: string | null; clinicId: string | null; action: string; targetType: string | null; targetId: string | null; outcome: string; metadata: unknown };
const harness = vi.hoisted(() => ({
  audits: [] as AuditRow[],
  transactions: 0,
  /** Simulates a stored doctor name (e.g. a malicious one) for the first doctor row; the database is not changed. */
  doctorNameOverride: null as string | null,
}));

vi.mock("@/server/db/tenant", async (orig) => {
  const real = await orig<typeof import("@/server/db/tenant")>();
  const ROLLBACK = Symbol("rollback");
  return {
    ...real,
    withTenantDb: async <T,>(ctx: TenantContext, fn: (tx: import("@/server/db/tenant").TenantTx) => Promise<T>): Promise<T> => {
      const { prisma } = await import("@/server/prisma");
      let out!: T;
      try {
        await prisma.$transaction(
          async (tx) => {
            harness.transactions++;
            await real.pinTenantContext(tx, ctx);
            const before = new Set((await tx.auditEvent.findMany({ where: { action: "report.exported" }, select: { id: true } })).map((e) => e.id));
            const override = harness.doctorNameOverride;
            const view = override
              ? (new Proxy(tx, {
                  get(target, prop, receiver) {
                    if (prop === "doctorProfile") {
                      return {
                        findMany: async (args: Parameters<typeof target.doctorProfile.findMany>[0]) =>
                          (await target.doctorProfile.findMany(args)).map((p, i) => (i === 0 ? { ...p, user: { name: override } } : p)),
                      };
                    }
                    const v = Reflect.get(target, prop, receiver);
                    return typeof v === "function" ? v.bind(target) : v;
                  },
                }) as typeof tx)
              : tx;
            out = await fn(view);
            const events = await tx.auditEvent.findMany({
              where: { action: "report.exported" },
              select: { id: true, actorUserId: true, clinicId: true, action: true, targetType: true, targetId: true, outcome: true, metadata: true },
            });
            for (const { id, ...event } of events) if (!before.has(id)) harness.audits.push(event);
            throw ROLLBACK;
          },
          { timeout: 60_000, maxWait: 10_000 }
        );
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }
      return out;
    },
  };
});

const exportRoute = await import("./export/route");

let admin: Client;
let adminA: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;
let counts: Record<string, number>;
const RANGE = { from: istDate(-60), to: istDate(30) };
const IN_RANGE = (col: string) => `${col} >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${col} < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  audit: await n(`SELECT count(*) n FROM audit_events`),
  invoices: await n(`SELECT count(*) n FROM invoices`),
  payments: await n(`SELECT count(*) n FROM payments`),
  patients: await n(`SELECT count(*) n FROM patients`),
  appointments: await n(`SELECT count(*) n FROM appointments`),
  users: await n(`SELECT count(*) n FROM users`),
});

async function get(query: string) {
  const res = await exportRoute.GET(new NextRequest(new URL(`/api/v1/reports/export?${query}`, "http://localhost:3000")), { params: Promise.resolve({}) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { status: res.status, headers: res.headers, bytes, text };
}
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
/** CSV rows (header first) without the BOM; cells split on commas (these reports have no quoted cells unless a name needs it). */
const lines = (csv: string) => csv.replace(/^﻿/, "").replace(/\r\n$/, "").split("\r\n");

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  doctor1 = await contextFor(admin, "DR-01");
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts); // every export was rolled back: no audit event or row left behind
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

const EXPECTED_HEADERS: Record<string, string> = {
  appointments: "Date,Total,Completed,Upcoming,In progress,Cancelled,No-shows",
  doctor_workload: "Doctor,Total,Completed,Upcoming,In progress,Cancelled,No-shows,No-show rate (%),Average consultation (min),Consultations timed",
  patient_registrations: "Date,New patients",
  collections: "Date,Collected (net, ₹),Refunded (₹)",
  payment_methods: "Method,Payments,Collected (net, ₹),Refunds,Refunded (₹)",
  outstanding_ageing: `Age (as of ${istDate(0)}),Invoices,Outstanding (₹)`,
};

describe("CSV export route (end to end, rolled back)", () => {
  it("an Administrator downloads every report: safe headers, BOM + CSV, and exactly one audit event without figures", async () => {
    signedIn = adminA;
    const bodies: string[] = [];
    for (const report of Object.keys(EXPECTED_HEADERS)) {
      harness.audits = [];
      const r = await get(qs({ report, ...RANGE }));
      expect(r.status, report).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("content-disposition")).toBe(`attachment; filename="sehat-setu_${report}_${RANGE.from}_to_${RANGE.to}.csv"`);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect([...r.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const rows = lines(r.text);
      // "Collected (net, ₹)" contains a comma, so the cell is quoted.
      expect(rows[0], report).toBe(EXPECTED_HEADERS[report].replace("Collected (net, ₹)", '"Collected (net, ₹)"'));
      expect(harness.audits, report).toEqual([
        { actorUserId: adminA.userId, clinicId: FIX.clinicA, action: "report.exported", targetType: "report", targetId: report, outcome: "SUCCESS", metadata: { from: RANGE.from, to: RANGE.to, branch: "all", rows: rows.length - 1 } },
      ]);
      bodies.push(r.text);
    }
    expect(harness.transactions).toBeGreaterThanOrEqual(6);

    // No patient-identifying information in any export: no patient name, number, phone or email (both clinics), no invoice numbers.
    const all = bodies.join("\n");
    const patients = (await admin.query(`SELECT name, "patientNumber", phone, email FROM patients`)).rows as { name: string; patientNumber: string; phone: string; email: string | null }[];
    expect(patients.length).toBeGreaterThan(0);
    for (const p of patients) {
      for (const v of [p.name, p.patientNumber, p.phone, p.phone.replace(/\D/g, ""), p.email]) if (v && v.length >= 4) expect(all, "patient detail in an export").not.toContain(v);
    }
    for (const { invoiceNumber } of (await admin.query(`SELECT "invoiceNumber" FROM invoices`)).rows) expect(all).not.toContain(invoiceNumber);
  });

  it("the exported figures match independent database totals", async () => {
    signedIn = adminA;
    const appts = lines((await get(qs({ report: "appointments", ...RANGE }))).text).slice(1);
    expect(appts).toHaveLength(91);
    expect(appts.reduce((t, l) => t + Number(l.split(",")[1]), 0)).toBe(await n(`SELECT count(*) n FROM appointments WHERE "clinicId" = $1 AND ${IN_RANGE('"startsAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]));

    const net = await n(`SELECT coalesce(sum(p."amountPaise"), 0) n FROM payments p WHERE p."clinicId" = $1 AND p.status = 'SUCCEEDED' AND ${IN_RANGE('p."paidAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]);
    const collections = lines((await get(qs({ report: "collections", ...RANGE }))).text).slice(1);
    expect(collections.reduce((t, l) => t + Math.round(Number(l.split(",")[1]) * 100), 0)).toBe(net);
    const methods = lines((await get(qs({ report: "payment_methods", ...RANGE }))).text).slice(1);
    expect(methods.map((l) => l.split(",")[0])).toEqual(["cash", "upi", "card", "bank_transfer", "online"]);
    expect(methods.reduce((t, l) => t + Math.round(Number(l.split(",")[2]) * 100), 0)).toBe(net);

    const owed = await n(`SELECT coalesce(sum(greatest(0, i."totalPaise" - coalesce((SELECT sum("amountPaise") FROM payments WHERE "invoiceId" = i.id AND status = 'SUCCEEDED'), 0))), 0) n FROM invoices i WHERE i."clinicId" = $1 AND i.status IN ('PENDING', 'PARTIALLY_PAID')`, [FIX.clinicA]);
    const ageing = lines((await get(qs({ report: "outstanding_ageing", ...RANGE }))).text).slice(1);
    expect(ageing.map((l) => l.split(",")[0])).toEqual(["Not yet due", "1–30 days overdue", "31–60 days overdue", "61–90 days overdue", "Over 90 days overdue"]);
    expect(ageing.reduce((t, l) => t + Math.round(Number(l.split(",")[2]) * 100), 0)).toBe(owed);

    const patientsCsv = lines((await get(qs({ report: "patient_registrations", ...RANGE }))).text).slice(1);
    expect(patientsCsv.reduce((t, l) => t + Number(l.split(",")[1]), 0)).toBe(await n(`SELECT count(*) n FROM patients WHERE "clinicId" = $1 AND ${IN_RANGE('"createdAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]));
  });

  it("a branch filter limits the export and is recorded in the audit event", async () => {
    signedIn = adminA;
    harness.audits = [];
    const r = await get(qs({ report: "collections", ...RANGE, branchId: FIX.wakad }));
    const wakadNet = await n(`SELECT coalesce(sum(p."amountPaise"), 0) n FROM payments p JOIN invoices i ON i.id = p."invoiceId" WHERE p."clinicId" = $1 AND p.status = 'SUCCEEDED' AND i."branchId" = $4 AND ${IN_RANGE('p."paidAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to, FIX.wakad]);
    expect(lines(r.text).slice(1).reduce((t, l) => t + Math.round(Number(l.split(",")[1]) * 100), 0)).toBe(wakadNet);
    expect(harness.audits).toEqual([expect.objectContaining({ targetId: "collections", metadata: { from: RANGE.from, to: RANGE.to, branch: FIX.wakad, rows: 91 } })]);
  });

  it("neutralises spreadsheet formulas in a stored name, end to end", async () => {
    signedIn = adminA;
    const cases: [string, string][] = [
      ['=HYPERLINK("http://evil.example","x")', `"'=HYPERLINK(""http://evil.example"",""x"")"`],
      ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
      ["+91-CMD", "'+91-CMD"],
      ["-2+3", "'-2+3"],
    ];
    try {
      for (const [name, expected] of cases) {
        harness.doctorNameOverride = name;
        const rows = lines((await get(qs({ report: "doctor_workload", ...RANGE }))).text);
        // The override applies to the first doctor loaded; rows are sorted by workload, so find it.
        expect(rows.slice(1).filter((r) => r.startsWith(`${expected},`)), `${name} -> ${rows.join(" | ")}`).toHaveLength(1);
        // No row starts with an unescaped formula character.
        for (const row of rows.slice(1)) expect(row, row).not.toMatch(/^"?[=+\-@\t\r]/);
      }
    } finally {
      harness.doctorNameOverride = null;
    }
  });

  it("refuses without exporting or auditing: no session, no reports.export, no reports.view, bad input", async () => {
    harness.audits = [];
    harness.transactions = 0;
    const refused: [TenantContext | null, string, number, string][] = [
      [null, qs({ report: "collections", ...RANGE }), 401, "UNAUTHENTICATED"],
      [managerWakad, qs({ report: "appointments", ...RANGE }), 403, "FORBIDDEN"], // reports.view but not reports.export
      [receptionWakad, qs({ report: "collections", ...RANGE }), 403, "FORBIDDEN"],
      [doctor1, qs({ report: "doctor_workload", ...RANGE }), 403, "FORBIDDEN"],
      [adminA, qs({ report: "patients_with_names", ...RANGE }), 400, "INVALID_INPUT"],
      [adminA, qs({ report: "appointments", from: "2026-10-10", to: "2026-10-01" }), 400, "INVALID_INPUT"],
      [adminA, qs({ report: "appointments", ...RANGE, branchId: "00000000-0000-4000-8000-000000000000" }), 400, "INVALID_INPUT"],
    ];
    for (const [ctx, query, status, code] of refused) {
      signedIn = ctx;
      const r = await get(query);
      expect(r.status, query).toBe(status);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(r.headers.get("content-disposition")).toBeNull();
      expect(JSON.parse(r.text).error.code).toBe(code);
    }
    expect(harness.audits).toEqual([]);
  });

  it("a branch-limited exporter gets only their branch and can't name another (in-memory grant; no role change)", async () => {
    // No branch-limited role holds reports.export today; grant it to the Wakad manager's context in memory only.
    signedIn = { ...managerWakad, permissions: new Set([...managerWakad.permissions, "reports.export"]) };
    const other = await get(qs({ report: "appointments", ...RANGE, branchId: FIX.kothrud }));
    expect(other.status).toBe(403);
    expect(JSON.parse(other.text).error.code).toBe("BRANCH_FORBIDDEN");
    const own = await get(qs({ report: "appointments", ...RANGE }));
    expect(own.status).toBe(200);
    const total = lines(own.text).slice(1).reduce((t, l) => t + Number(l.split(",")[1]), 0);
    expect(total).toBe(await n(`SELECT count(*) n FROM appointments WHERE "clinicId" = $1 AND "branchId" = $4 AND ${IN_RANGE('"startsAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to, FIX.wakad]));
  });
});

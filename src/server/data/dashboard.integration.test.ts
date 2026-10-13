import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { demoId } from "../../../prisma/seed/demo-data";
import { verifiedPgConfig } from "@/server/db/tls";
import { resolveTenantContext, type Identity, type RoleKey, type TenantContext } from "@/server/auth/authorize";
import { istDayRange } from "@/lib/ist";
import { getDashboardData } from "./dashboard";

// Runs the real dashboard queries as each demo fixture user and compares them
// with ground truth computed independently as `postgres` (which bypasses RLS).

const CLINIC_A = demoId("clinic:AAR");
const CLINIC_B = demoId("clinic:NIR");
const BRANCH_WAKAD = demoId("branch:AAR-WKD");
const NOW = new Date();
let admin: Client;

/** Builds the identity exactly as the app would, from the database (as postgres). */
async function identityFor(userKey: string): Promise<Identity> {
  const userId = demoId(`user:${userKey}`);
  const user = (await admin.query(`SELECT id, email, name FROM users WHERE id = $1`, [userId])).rows[0];
  const memberships = (
    await admin.query(
      `SELECT m.id, m."clinicId", c.name AS "clinicName", c.status AS "clinicStatus", m."branchId", r.key AS "roleKey", m.status,
              coalesce(array_agg(p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
       FROM clinic_memberships m JOIN clinics c ON c.id = m."clinicId" JOIN roles r ON r.id = m."roleId"
       LEFT JOIN role_permissions rp ON rp."roleId" = r.id LEFT JOIN permissions p ON p.id = rp."permissionId"
       WHERE m."userId" = $1 GROUP BY m.id, c.name, c.status, r.key`,
      [userId]
    )
  ).rows.map((m) => ({ ...m, roleKey: m.roleKey as RoleKey }));
  const doctorProfiles = (await admin.query(`SELECT id, "clinicId" FROM doctor_profiles WHERE "userId" = $1`, [userId])).rows;
  // Fixture users are INVITED (no login); the app only builds contexts for linked ACTIVE users.
  return { userId, authUserId: `test-${userKey}`, email: user.email, name: user.name, status: "ACTIVE", memberships, doctorProfiles };
}

const scalar = async (sql: string, params: unknown[]) => Number((await admin.query(sql, params)).rows[0].n);

beforeAll(async () => {
  admin = new Client(verifiedPgConfig(process.env.DIRECT_URL!));
  await admin.connect();
});
afterAll(async () => {
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("dashboard data from the database", () => {
  const today = istDayRange(NOW, 0);

  it("matches clinic A's real totals for its administrator", async () => {
    const ctx = resolveTenantContext(await identityFor("ST-01"));
    const data = await getDashboardData(ctx, NOW);
    expect(data.clinicName).toBe("Aarogya Multispeciality Clinic");
    expect(data.totalPatients).toBe(await scalar(`SELECT count(*) n FROM patients WHERE "clinicId" = $1 AND status <> 'ARCHIVED'`, [CLINIC_A]));
    expect(data.activeDoctors).toBe(await scalar(`SELECT count(*) n FROM doctor_profiles WHERE "clinicId" = $1 AND status = 'ACTIVE'`, [CLINIC_A]));
    expect(data.today.total).toBe(
      await scalar(`SELECT count(*) n FROM appointments WHERE "clinicId" = $1 AND "startsAt" >= $2 AND "startsAt" < $3`, [CLINIC_A, today.start, today.end])
    );
    const outstandingPaise = await scalar(
      `SELECT coalesce(sum(i."totalPaise" - coalesce((SELECT sum(p."amountPaise") FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'SUCCEEDED'), 0)), 0) n
       FROM invoices i WHERE i."clinicId" = $1 AND i.status IN ('PENDING', 'PARTIALLY_PAID')`,
      [CLINIC_A]
    );
    expect(data.billing?.outstanding).toBe(outstandingPaise / 100);
    expect(data.billing?.invoiceCounts.paid).toBe(await scalar(`SELECT count(*) n FROM invoices WHERE "clinicId" = $1 AND status = 'PAID'`, [CLINIC_A]));
    const statusTotal = data.statusBreakdown.reduce((s, x) => s + x.count, 0);
    expect(statusTotal).toBeGreaterThan(0);
  });

  it("never returns another clinic's appointments", async () => {
    const data = await getDashboardData(resolveTenantContext(await identityFor("ST-01")), NOW);
    const ids = [...data.todaysAppointments, ...data.recentAppointments].map((a) => a.id);
    if (ids.length) {
      expect(await scalar(`SELECT count(*) n FROM appointments WHERE id = ANY($1::uuid[]) AND "clinicId" <> $2`, [ids, CLINIC_A])).toBe(0);
    }
    const b = await getDashboardData(resolveTenantContext(await identityFor("ST-07")), NOW);
    expect(b.clinicName).toBe("Nirmaya Family Health");
    expect(b.totalPatients).toBe(await scalar(`SELECT count(*) n FROM patients WHERE "clinicId" = $1`, [CLINIC_B]));
    const bIds = [...b.todaysAppointments, ...b.recentAppointments].map((a) => a.id);
    expect(bIds.some((id) => ids.includes(id))).toBe(false);
  });

  it("returns nothing for a forged context (clinic B admin claiming clinic A), because RLS re-verifies membership", async () => {
    const real = resolveTenantContext(await identityFor("ST-07"));
    const forged: TenantContext = { ...real, clinicId: CLINIC_A, clinicName: "forged" };
    const data = await getDashboardData(forged, NOW);
    expect(data.totalPatients).toBe(0);
    expect(data.activeDoctors).toBe(0);
    expect(data.today.total).toBe(0);
    expect(data.recentAppointments).toHaveLength(0);
    expect(data.billing?.outstanding).toBe(0);
    expect(data.statusBreakdown).toHaveLength(0);
  });

  it("limits a branch-restricted receptionist to their branch", async () => {
    const ctx = resolveTenantContext(await identityFor("ST-04"));
    expect(ctx.branchId).toBe(BRANCH_WAKAD);
    const data = await getDashboardData(ctx, NOW);
    expect(data.branchName).toBe("Aarogya — Wakad");
    expect(data.today.total).toBe(
      await scalar(`SELECT count(*) n FROM appointments WHERE "branchId" = $1 AND "startsAt" >= $2 AND "startsAt" < $3`, [BRANCH_WAKAD, today.start, today.end])
    );
    for (const a of [...data.todaysAppointments, ...data.recentAppointments]) expect(a.branchName).toBe("Aarogya — Wakad");
  });

  it("scopes a doctor to their own appointments and patients, with no billing", async () => {
    const ctx = resolveTenantContext(await identityFor("DR-01"));
    expect(ctx.careScope).toBe("own");
    const data = await getDashboardData(ctx, NOW);
    expect(data.scope).toBe("own");
    expect(data.billing).toBeNull();
    expect(data.totalPatients).toBe(
      await scalar(`SELECT count(DISTINCT "patientId") n FROM appointments WHERE "doctorId" = $1`, [demoId("doctor:DR-01")])
    );
    for (const a of [...data.todaysAppointments, ...data.recentAppointments]) expect(a.doctorName).toBe("Dr. Meera Kulkarni");
  });
});

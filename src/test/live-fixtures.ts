// Shared helpers for live-database integration tests (npm run test:integration).
// Fixtures are the fictional demo seed users; nothing here creates real data.
import { Client } from "pg";
import { demoId } from "../../prisma/seed/demo-data";
import { verifiedPgConfig } from "@/server/db/tls";
import { resolvePatientContext, resolveTenantContext, type Identity, type PatientContext, type RoleKey, type TenantContext } from "@/server/auth/authorize";
import { AuthError } from "@/server/auth/errors";

export const FIX = {
  clinicA: demoId("clinic:AAR"),
  clinicB: demoId("clinic:NIR"),
  kothrud: demoId("branch:AAR-KTH"),
  wakad: demoId("branch:AAR-WKD"),
  doctor1: demoId("doctor:DR-01"), // Aarogya, Kothrud + Wakad
  doctor2: demoId("doctor:DR-02"), // Aarogya, Kothrud only
};

/** Admin (postgres) client for ground truth. Bypasses RLS — never used to test access. */
export function adminClient(): Client {
  return new Client(verifiedPgConfig(process.env.DIRECT_URL!));
}

/** Builds a fixture user's identity exactly as the app does (memberships → role permissions). */
export async function identityFor(admin: Client, userKey: string): Promise<Identity> {
  return identityForUserId(admin, demoId(`user:${userKey}`), userKey);
}

/** Like identityFor, for any existing user id (e.g. the clinic's own administrator on a database without demo fixtures). */
export async function identityForUserId(admin: Client, userId: string, userKey = userId): Promise<Identity> {
  const user = (await admin.query(`SELECT id, email, name FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) throw new Error(`Fixture user ${userKey} missing — run npm run db:seed`);
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

export async function contextFor(admin: Client, userKey: string): Promise<TenantContext> {
  return resolveTenantContext(await identityFor(admin, userKey));
}

/** The first active administrator's context (works with or without the demo seed). */
export async function activeAdminContext(admin: Client): Promise<TenantContext> {
  const row = (
    await admin.query(
      `SELECT u.id FROM users u JOIN clinic_memberships m ON m."userId" = u.id AND m.status = 'ACTIVE' AND m."branchId" IS NULL
       JOIN roles r ON r.id = m."roleId" AND r.key = 'ADMINISTRATOR' JOIN clinics c ON c.id = m."clinicId" AND c.status = 'ACTIVE'
       ORDER BY u."createdAt", u.id LIMIT 1`
    )
  ).rows[0];
  if (!row) throw new Error("No active clinic administrator in this database");
  return resolveTenantContext(await identityForUserId(admin, row.id));
}

/** A fixture patient-portal user's context, built exactly as the app does (membership + server-side record link). */
export async function patientContextFor(admin: Client, userKey: string): Promise<PatientContext> {
  const identity = await identityFor(admin, userKey);
  const links = (await admin.query(`SELECT id AS "patientId", "clinicId" FROM patients WHERE "userId" = $1 AND status = 'ACTIVE'`, [identity.userId])).rows;
  return resolvePatientContext({ ...identity, patientLinks: links });
}

/** Pins a patient-portal context on a transaction exactly like withPatientDb (user + clinic only). */
export async function pinPatient(tx: import("@/server/db/tenant").TenantTx, ctx: PatientContext): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${ctx.authUserId}, true), set_config('app.user_id', ${ctx.userId}, true),
    set_config('app.clinic_id', ${ctx.clinicId}, true), set_config('app.branch_id', '', true)`;
}

/**
 * Like contextFor, but undefined when the fixture user has no usable staff
 * membership (e.g. deactivated from the Staff directory). Only that user's
 * cases are skipped, with a warning, instead of failing the whole file.
 * Never reactivates anyone.
 */
export async function optionalContextFor(admin: Client, userKey: string): Promise<TenantContext | undefined> {
  try {
    return await contextFor(admin, userKey);
  } catch (err) {
    if (err instanceof AuthError && err.code === "NO_MEMBERSHIP") {
      console.warn(`Fixture ${userKey} has no active staff membership; its cases are skipped.`);
      return undefined;
    }
    throw err;
  }
}

/** The contexts that exist (drops fixtures skipped by optionalContextFor). */
export const present = (...ctxs: (TenantContext | undefined)[]): TenantContext[] => ctxs.filter((c): c is TenantContext => c !== undefined);

const ROLLBACK = Symbol("rollback");

/**
 * Runs `fn` inside ONE database transaction as the runtime role and then rolls
 * it back, so tests can exercise real writes without leaving any rows behind.
 * `as(ctx)` re-pins a different user's context within the same transaction.
 */
export async function inRollback(fn: (tools: { tx: import("@/server/db/tenant").TenantTx; as: (ctx: TenantContext) => Promise<void> }) => Promise<void>): Promise<void> {
  const { prisma } = await import("@/server/prisma");
  const { pinTenantContext } = await import("@/server/db/tenant");
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn({ tx, as: (ctx) => pinTenantContext(tx, ctx) });
        throw ROLLBACK;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

/** IST date (yyyy-MM-dd) `days` from today. */
export function istDate(days: number): string {
  const d = new Date(Date.now() + 330 * 60_000 + days * 864e5);
  return d.toISOString().slice(0, 10);
}

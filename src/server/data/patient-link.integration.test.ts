import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, optionalContextFor, pinPatient } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import { resolvePatientContext, type Identity, type PatientContext, type RoleKey, type TenantContext, type VerifiedAuthUser } from "@/server/auth/authorize";
import { AuthError } from "@/server/auth/errors";
import type { TenantTx } from "@/server/db/tenant";
import { createLabReport, reviewLabReport, setLabReportShared, setLabReportValues } from "./lab-reports";
import { getPortalSummary, listMyLabReports } from "./portal";
import { getPortalLinkStatus, issuePortalLinkCode, redeemPortalLinkCode, revokePortalLinkCode } from "./patient-link";
import { LINK_CODE_PATTERN } from "./patient-link-rules";

// P6.4 patient portal linking codes against the live database, as the runtime
// role (sehat_app) with real RLS. Every write happens in ONE transaction that is
// rolled back (inRollback), or — where a test must set up state the runtime role
// may not create (an expired code, a disabled login) — in a BEGIN/ROLLBACK on
// the admin connection that calls the same functions with the same pinned
// settings. Fake Supabase ids ("zz-auth-…") and example.com addresses only: no
// Supabase account is created and no email is sent. Table counts and checksums
// are compared afterwards, so nothing persists.

let admin: Client;
let adminA: TenantContext, adminB: TenantContext, managerWakad: TenantContext, doctor1: TenantContext;
let receptionWakad: TenantContext | undefined, nurse: TenantContext | undefined;
let target: string, other: string, spare: string[];
let fingerprint: string;

const TABLES = ["users", "clinic_memberships", "patients", "patient_link_codes", "patient_link_attempts", "audit_events", "lab_reports", "patient_documents"];
async function snapshot(): Promise<string> {
  const parts: string[] = [];
  for (const t of TABLES) parts.push(`${t}:${(await admin.query(`SELECT count(*) AS n, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h FROM ${t} x`)).rows.map((r) => `${r.n}/${r.h}`)[0]}`);
  return parts.join("|");
}

const login = (key: string, confirmed = true): VerifiedAuthUser => ({ id: `zz-auth-p64-${key}`, email: `zztest.p64.${key}@example.com`, emailConfirmed: confirmed });
/**
 * Runs an operation that may be refused inside a SAVEPOINT (PostgreSQL aborts the whole
 * transaction on any error) and returns the error code, or "OK".
 */
async function codeIn(tx: TenantTx, fn: () => Promise<unknown>): Promise<string | undefined> {
  await tx.$executeRawUnsafe("SAVEPOINT p64_attempt");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT p64_attempt");
    return "OK";
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT p64_attempt");
    return (e as { code?: string; name?: string }).code ?? (e as { name?: string }).name;
  }
}
const result = async (p: Promise<{ result: string }>) => (await p).result;

/** The identity the app would load for this login right now (as loadIdentity does), or NOT_PROVISIONED. */
async function portalContextIn(tx: TenantTx, authUser: VerifiedAuthUser): Promise<PatientContext> {
  await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authUser.id}, true), set_config('app.user_id', '', true), set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`;
  const user = await tx.user.findUnique({ where: { authProviderId: authUser.id }, select: { id: true, email: true, name: true, status: true } });
  if (!user) throw new AuthError("NOT_PROVISIONED");
  await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
  const memberships = await tx.clinicMembership.findMany({
    where: { userId: user.id },
    select: { id: true, clinicId: true, branchId: true, status: true, clinic: { select: { name: true, status: true } }, role: { select: { key: true } } },
  });
  const links = await tx.patient.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, clinicId: true } });
  const identity: Identity = {
    userId: user.id, authUserId: authUser.id, email: user.email, name: user.name, status: user.status,
    memberships: memberships.map((m) => ({ id: m.id, clinicId: m.clinicId, clinicName: m.clinic.name, clinicStatus: m.clinic.status, branchId: m.branchId, roleKey: m.role.key as RoleKey, status: m.status, permissions: [] })),
    patientLinks: links.map((l) => ({ patientId: l.id, clinicId: l.clinicId })),
  };
  return resolvePatientContext(identity);
}

/** What a pinned login with NO application account can see (RLS). */
const visibleTo = async (tx: TenantTx, authUser: VerifiedAuthUser) => {
  await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authUser.id}, true), set_config('app.user_id', '', true), set_config('app.clinic_id', ${FIX.clinicA}, true), set_config('app.branch_id', '', true)`;
  return (await tx.$queryRaw<{ patients: number; reports: number; documents: number; appointments: number }[]>`
    SELECT (SELECT count(*) FROM patients)::int AS patients, (SELECT count(*) FROM lab_reports)::int AS reports,
           (SELECT count(*) FROM patient_documents)::int AS documents, (SELECT count(*) FROM appointments)::int AS appointments`)[0];
};

/** Runs `fn` on the admin connection inside BEGIN/ROLLBACK (state the runtime role may not create). */
async function adminRollback(fn: () => Promise<void>) {
  await admin.query("BEGIN");
  try {
    await fn();
  } finally {
    await admin.query("ROLLBACK");
  }
}
const pinStaffAdmin = (userKey: string, clinicKey: string) =>
  admin.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', '', true), set_config('app.auth_user_id', '', true)`,
    [demoId(`user:${userKey}`), demoId(`clinic:${clinicKey}`)]);
const redeemAdmin = async (who: VerifiedAuthUser, c: string) => {
  await admin.query(`SELECT set_config('app.auth_user_id', $1, true), set_config('app.user_id', '', true), set_config('app.clinic_id', '', true)`, [who.id]);
  return (await admin.query(`SELECT result FROM app.redeem_patient_link_code($1, $2)`, [c, who.email])).rows[0].result as string;
};

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  [adminA, adminB, managerWakad, doctor1] = [await contextFor(admin, "ST-01"), await contextFor(admin, "ST-07"), await contextFor(admin, "ST-02"), await contextFor(admin, "DR-01")];
  receptionWakad = await optionalContextFor(admin, "ST-04");
  nurse = await optionalContextFor(admin, "ST-05");
  // Two unlinked patients DR-01 has seen (so the doctor can review their reports), plus spares.
  const drPatients = (await admin.query(
    `SELECT DISTINCT p.id, p."patientNumber" FROM patients p JOIN appointments a ON a."patientId" = p.id
      WHERE a."doctorId" = $1 AND p."userId" IS NULL AND p.status = 'ACTIVE' ORDER BY p."patientNumber"`, [FIX.doctor1])).rows.map((r) => r.id as string);
  expect(drPatients.length, "fixture: two unlinked DR-01 patients").toBeGreaterThanOrEqual(2);
  [target, other] = drPatients;
  spare = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NULL AND status = 'ACTIVE' AND id <> ALL ($2) ORDER BY "patientNumber" LIMIT 4`,
    [FIX.clinicA, [target, other]])).rows.map((r) => r.id as string);
  expect(spare.length).toBe(4);
  fingerprint = await snapshot();
});

afterAll(async () => {
  expect(await snapshot(), "nothing committed").toBe(fingerprint);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("issuing codes: permission and clinic scope (app AND database)", () => {
  it("only Administrator and Receptionist may issue, revoke or read status; never for another clinic's patient", async () => {
    await inRollback(async ({ tx, as }) => {
      for (const ctx of [managerWakad, doctor1, ...(nurse ? [nurse] : [])]) {
        await as(ctx);
        expect(await codeIn(tx, () => issuePortalLinkCode(ctx, target, { identityVerified: true }, tx)), ctx.roles.join()).toBe("FORBIDDEN");
        expect(await codeIn(tx, () => getPortalLinkStatus(ctx, target, tx))).toBe("FORBIDDEN");
        expect(await codeIn(tx, () => revokePortalLinkCode(ctx, target, tx))).toBe("FORBIDDEN");
        // The database refuses too, even if the app check were bypassed.
        const forged = { ...ctx, permissions: new Set([...ctx.permissions, "patient.portal_link"]) };
        expect(await codeIn(tx, () => issuePortalLinkCode(forged, target, { identityVerified: true }, tx)), `${ctx.roles.join()} (forged)`).toBe("FORBIDDEN");
      }
      await as(adminB);
      expect(await codeIn(tx, () => issuePortalLinkCode(adminB, target, { identityVerified: true }, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => getPortalLinkStatus(adminB, target, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => revokePortalLinkCode(adminB, target, tx))).toBe("NOT_FOUND");
      await as(adminA);
      expect(await codeIn(tx, () => issuePortalLinkCode(adminA, "not-a-uuid", { identityVerified: true }, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => issuePortalLinkCode(adminA, target, {}, tx))).toBe("ZodError"); // identity check must be confirmed
      expect(await codeIn(tx, () => issuePortalLinkCode(adminA, target, { identityVerified: true, clinicId: FIX.clinicB }, tx))).toBe("ZodError"); // strict
      const issuer = receptionWakad ?? adminA;
      await as(issuer);
      const issued = await issuePortalLinkCode(issuer, target, { identityVerified: true }, tx);
      expect(issued.code).toMatch(LINK_CODE_PATTERN);
      const status = await getPortalLinkStatus(issuer, target, tx);
      expect(status).toEqual({ linked: false, activeCode: { issuedAt: expect.any(String), expiresAt: issued.expiresAt } });
      expect(JSON.stringify(status)).not.toContain(issued.code);
      const hours = (Date.parse(issued.expiresAt) - Date.parse(status.activeCode!.issuedAt)) / 3_600_000;
      expect(hours).toBeCloseTo(72, 1);
      expect(await revokePortalLinkCode(issuer, target, tx)).toEqual({ revoked: true });
      expect(await revokePortalLinkCode(issuer, target, tx)).toEqual({ revoked: false });
      expect((await getPortalLinkStatus(issuer, target, tx)).activeCode).toBeNull();
    });
  });
});

describe("redeeming: unlinked logins see nothing; a valid code links exactly one record", () => {
  it("links, gives access to only the patient's own reviewed and shared reports, and is single-use", async () => {
    await inRollback(async ({ tx, as }) => {
      // Fixtures: shared+reviewed for the target and for another patient; reviewed-only for the target.
      await as(doctor1);
      const mk = async (patientId: string, title: string, share: boolean) => {
        const { id } = await createLabReport(doctor1, { patientId, testType: "CBC", title }, tx);
        await setLabReportValues(doctor1, id, { values: [{ parameter: "Hb", value: "13", unit: "g/dL", range: "12-16", flag: "normal" }] }, tx);
        await reviewLabReport(doctor1, id, tx);
        if (share) await setLabReportShared(doctor1, id, true, tx);
        return id;
      };
      const mine = await mk(target, "ZZTEST mine", true);
      await mk(target, "ZZTEST not shared", false);
      await mk(other, "ZZTEST someone else", true);

      const patient = login("patient");
      // Before redeeming: no application account, no access to anything.
      expect(await codeIn(tx, () => portalContextIn(tx, patient))).toBe("NOT_PROVISIONED");
      expect(await visibleTo(tx, patient)).toEqual({ patients: 0, reports: 0, documents: 0, appointments: 0 });

      await as(adminA);
      const { code: c } = await issuePortalLinkCode(adminA, target, { identityVerified: true }, tx);
      // An unconfirmed email and a browser-chosen patient/clinic are refused before the database.
      expect(await codeIn(tx, () => redeemPortalLinkCode(login("patient", false), { code: c }, tx))).toBe("EMAIL_NOT_VERIFIED");
      expect(await codeIn(tx, () => redeemPortalLinkCode(patient, { code: c, patientId: other }, tx))).toBe("ZodError");
      expect(await codeIn(tx, () => redeemPortalLinkCode(patient, { code: c, clinicId: FIX.clinicB }, tx))).toBe("ZodError");

      // Lower case, spaces instead of dashes: still the same code.
      const linked = await redeemPortalLinkCode(patient, { code: c.toLowerCase().replace(/-/g, " ") }, tx);
      expect(linked).toEqual({ result: "LINKED", clinicId: FIX.clinicA });
      const ctx = await portalContextIn(tx, patient);
      expect(ctx).toMatchObject({ clinicId: FIX.clinicA, patientIds: [target] });
      await pinPatient(tx, ctx);
      expect((await listMyLabReports(ctx, {}, tx)).items.map((r) => r.id)).toEqual([mine]);
      expect(await getPortalSummary(ctx, tx)).toMatchObject({ reportCount: 1 });

      // Single use: the same login gets an idempotent answer, anyone else the generic one.
      expect(await result(redeemPortalLinkCode(patient, { code: c }, tx))).toBe("ALREADY_LINKED");
      expect(await result(redeemPortalLinkCode(login("thief"), { code: c }, tx))).toBe("INVALID");
      expect(await codeIn(tx, () => portalContextIn(tx, login("thief")))).toBe("NOT_PROVISIONED");

      // Existing links are never replaced: the linked patient can't get a new code ...
      await as(adminA);
      expect(await codeIn(tx, () => issuePortalLinkCode(adminA, target, { identityVerified: true }, tx))).toBe("CONFLICT");
      expect((await getPortalLinkStatus(adminA, target, tx)).linked).toBe(true);
      // ... and the linked login can't take a second patient (the code stays usable for the clinic).
      const { code: c2 } = await issuePortalLinkCode(adminA, spare[0], { identityVerified: true }, tx);
      expect(await result(redeemPortalLinkCode(patient, { code: c2 }, tx))).toBe("NOT_ELIGIBLE");
      await as(adminA);
      expect((await getPortalLinkStatus(adminA, spare[0], tx)).activeCode).not.toBeNull();
      // Another clinic's administrator still can't see or touch the record.
      await as(adminB);
      expect(await codeIn(tx, () => getPortalLinkStatus(adminB, target, tx))).toBe("NOT_FOUND");

      // Audit: issued + linked events for the clinic, with no code in them.
      await as(adminA);
      const events = await tx.$queryRaw<{ action: string; metadata: unknown; reason: string | null }[]>`
        SELECT action, metadata, reason FROM audit_events WHERE action LIKE 'patient.%' AND "occurredAt" >= now()`;
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["patient.link_code_issued", "patient.portal_linked"]));
      const text = JSON.stringify(events).toUpperCase();
      for (const x of [c, c2]) expect(text).not.toContain(x.replace(/-/g, ""));
    });
  });

  it("wrong, superseded and revoked codes give one generic answer; 5 failures lock the login for 15 minutes", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const first = (await issuePortalLinkCode(adminA, spare[1], { identityVerified: true }, tx)).code;
      const second = (await issuePortalLinkCode(adminA, spare[1], { identityVerified: true }, tx)).code; // supersedes the first
      const revoked = (await issuePortalLinkCode(adminA, spare[2], { identityVerified: true }, tx)).code;
      await revokePortalLinkCode(adminA, spare[2], tx);

      const guesser = login("guesser");
      const answers = [];
      for (const c of [first, revoked, "ABCD-EFGH-JKMN-PQRS", "hello", "x".repeat(64)]) answers.push(await result(redeemPortalLinkCode(guesser, { code: c }, tx)));
      expect(answers).toEqual(["INVALID", "INVALID", "INVALID", "INVALID", "INVALID"]);
      // Locked: even the valid code is refused now, and nothing is linked.
      expect(await result(redeemPortalLinkCode(guesser, { code: second }, tx))).toBe("RATE_LIMITED");
      expect(await codeIn(tx, () => portalContextIn(tx, guesser))).toBe("NOT_PROVISIONED");
      // The limit is per login: someone else redeems the valid code.
      expect(await result(redeemPortalLinkCode(login("rightful"), { code: second }, tx))).toBe("LINKED");
      expect((await portalContextIn(tx, login("rightful"))).patientIds).toEqual([spare[1]]);
      expect(await codeIn(tx, () => redeemPortalLinkCode(login("long"), { code: "x".repeat(65) }, tx))).toBe("ZodError");
    });
  });

  it("an expired code, a disabled login and a staff member of the clinic are refused (admin BEGIN/ROLLBACK)", async () => {
    await adminRollback(async () => {
      await pinStaffAdmin("ST-01", "AAR");
      const c = (await admin.query(`SELECT code FROM app.issue_patient_link_code($1, true)`, [spare[3]])).rows[0].code as string;
      await admin.query(`UPDATE patient_link_codes SET "createdAt" = now() - interval '4 days', "expiresAt" = now() - interval '1 second' WHERE "patientId" = $1 AND status = 'ACTIVE'`, [spare[3]]);
      expect(await redeemAdmin(login("late"), c)).toBe("INVALID");

      await admin.query(`UPDATE patient_link_codes SET "createdAt" = now(), "expiresAt" = now() + interval '1 hour' WHERE "patientId" = $1 AND status = 'ACTIVE'`, [spare[3]]);
      const disabled = login("disabled");
      await admin.query(`INSERT INTO users (id, email, name, status, "authProviderId", "updatedAt") VALUES (gen_random_uuid(), $1, 'ZZTEST', 'DISABLED', $2, now())`, [disabled.email, disabled.id]);
      expect(await redeemAdmin(disabled, c)).toBe("NOT_ELIGIBLE");

      const staffEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [demoId("user:ST-02")])).rows[0].email as string;
      expect(await redeemAdmin({ id: "zz-auth-p64-staff", email: staffEmail, emailConfirmed: true }, c)).toBe("NOT_ELIGIBLE");
      // Still usable by the right person afterwards.
      expect(await redeemAdmin(login("eventual"), c)).toBe("LINKED");
    });
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import { verifiedPgConfig } from "@/server/db/tls";
import type { Identity, TenantContext } from "@/server/auth/authorize";
import type { VerifiedIdentity } from "@/server/api/route-handler";
import type { TenantTx } from "@/server/db/tenant";
import type { InvitationMailer } from "@/server/supabase-admin";
import { acceptInvitation, createInvitation, listInvitations, listMyInvitations, resendInvitation, revokeInvitation } from "./invitations";
import { listAppointments, createAppointment } from "./appointments";
import { listStaff } from "./people";
import { listNotifications } from "./notifications";

// Staff invitations against the live database (migration 20261019000100).
// Skipped automatically until that migration is applied. Every write happens
// inside a transaction that is rolled back (inRollback, or BEGIN/ROLLBACK on a
// raw client); emails are never sent (a fake mailer stands in for Supabase).
// Table counts and checksums are compared before/after, so nothing persists.
// Test emails use the reserved example.com domain and start with "zztest".

const probe = adminClient();
await probe.connect();
// Ready = the P5 tables exist AND the create function carries the 20261019000200 fix ("P5-FIX-1")
// and the 20261020000000 phone number ("P5-PHONE-1", new signature with p_phone).
const READY_SQL = `SELECT to_regclass('public.staff_invitations') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL
  AND coalesce((SELECT position('P5-FIX-1' IN prosrc) > 0 AND position('P5-PHONE-1' IN prosrc) > 0 FROM pg_proc
                WHERE oid = to_regprocedure('app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean)')), false) AS ok`;
const TABLES = Boolean((await probe.query(`SELECT to_regclass('public.staff_invitations') IS NOT NULL AS ok`)).rows[0].ok);
const APPLIED = Boolean((await probe.query(READY_SQL)).rows[0].ok);
await probe.end();

let admin: Client;
let adminA: TenantContext, adminB: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;
let fingerprint: string;

const ok: InvitationMailer = { invite: async () => ({ error: null }), signInLink: async () => ({ error: null }) };
const existingAccount = (): InvitationMailer & { signInLink: ReturnType<typeof vi.fn> } => ({
  invite: async () => ({ error: { code: "email_exists", status: 422 } }),
  signInLink: vi.fn(async () => ({ error: null })),
});
const rateLimited: InvitationMailer = { invite: async () => ({ error: { code: "over_email_send_rate_limit", status: 429 } }), signInLink: async () => ({ error: null }) };

type Failure = { code?: string; name?: string; details?: unknown; message: string };
/**
 * Runs an operation that may be refused, inside a SAVEPOINT: PostgreSQL aborts the
 * whole transaction on any error, so without this the rest of a rolled-back test
 * would fail with 25P02. Returns the error (or null).
 */
async function attemptIn(tx: TenantTx, fn: () => Promise<unknown>): Promise<Failure | null> {
  await tx.$executeRawUnsafe("SAVEPOINT p5_attempt");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT p5_attempt");
    return null;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT p5_attempt");
    return e as Failure;
  }
}
const codeIn = async (tx: TenantTx, fn: () => Promise<unknown>) => {
  const e = await attemptIn(tx, fn);
  return e ? (e.code ?? e.name) : "OK";
};
/** A fictional number (rolled-back tests only; never dialled or emailed). */
const PHONE = "+919800000001";
const nurse = (email: string, branchId = FIX.wakad) => ({ email, name: "ZZTEST Person", roleKey: "NURSE", branchId, phone: PHONE });

async function snapshot(c: Client): Promise<string> {
  const tables = ["users", "clinic_memberships", "doctor_profiles", "doctor_branches", "staff_invitations", "staff_invitation_doctor_details", "notifications", "notification_reads", "audit_events", "appointments"];
  const parts: string[] = [];
  for (const t of tables) parts.push(`${t}:${(await c.query(`SELECT count(*) AS n, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h FROM ${t} x`)).rows.map((r) => `${r.n}/${r.h}`)[0]}`);
  return parts.join("|");
}

/** Links an INVITED account to a (fake) Supabase identity inside the transaction, the way first sign-in does. */
async function signInAs(tx: TenantTx, email: string, authId: string): Promise<VerifiedIdentity> {
  await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authId}, true), set_config('app.user_id', '', true), set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`;
  const [{ id }] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app.link_auth_user(${authId}, ${email})::text AS id`;
  if (!id) throw new Error(`could not link ${email}`);
  await tx.$executeRaw`SELECT set_config('app.user_id', ${id}, true)`;
  return { userId: id, authUserId: authId, email, name: "ZZTEST", status: "ACTIVE", memberships: [], verifiedEmail: email };
}

/** Re-pins an identity-only context (no clinic), as /api/v1/me/* requests run. */
const pinUser = (tx: TenantTx, who: VerifiedIdentity) =>
  tx.$executeRaw`SELECT set_config('app.auth_user_id', ${who.authUserId}, true), set_config('app.user_id', ${who.userId}, true), set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`;

/** The identity the app would load for this user right now (as loadIdentity does, inside the transaction). */
async function identityIn(tx: TenantTx, who: VerifiedIdentity): Promise<Identity> {
  await pinUser(tx, who);
  const rows = await tx.clinicMembership.findMany({
    where: { userId: who.userId },
    select: {
      id: true, clinicId: true, branchId: true, status: true,
      clinic: { select: { name: true, status: true } },
      role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  });
  return {
    ...who,
    memberships: rows.map((m) => ({
      id: m.id, clinicId: m.clinicId, clinicName: m.clinic.name, clinicStatus: m.clinic.status, branchId: m.branchId,
      roleKey: m.role.key as Identity["memberships"][number]["roleKey"], status: m.status, permissions: m.role.permissions.map((p) => p.permission.key),
    })),
  };
}

/** What the runtime role can see under the currently pinned context (RLS). */
const visibleCounts = async (tx: TenantTx) =>
  (await tx.$queryRaw<{ patients: number; appointments: number; memberships: number; invitations: number }[]>`
    SELECT (SELECT count(*) FROM patients)::int AS patients, (SELECT count(*) FROM appointments)::int AS appointments,
           (SELECT count(*) FROM clinic_memberships)::int AS memberships, (SELECT count(*) FROM staff_invitations)::int AS invitations`)[0];

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  adminB = await contextFor(admin, "ST-07");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  doctor1 = await contextFor(admin, "DR-01");
  if (APPLIED) fingerprint = await snapshot(admin);
});

afterAll(async () => {
  if (APPLIED) expect(await snapshot(admin)).toBe(fingerprint); // nothing persisted
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe.skipIf(!APPLIED)("staff invitations (live database, rolled back)", () => {
  it("an administrator invites; the email is sent; nothing is granted before acceptance", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const r = await createInvitation(adminA, nurse("ZZTest.Nurse@Example.com"), tx, { mailer: ok });
      expect(r.delivery).toEqual({ status: "sent" });
      expect(r.invitation).toMatchObject({ email: "zztest.nurse@example.com", roleKey: "NURSE", status: "pending", delivery: "sent", sendAttempts: 1, branch: { id: FIX.wakad } });
      expect(Math.abs(Date.parse(r.invitation.expiresAt) - (Date.now() + 7 * 864e5))).toBeLessThan(120_000);
      const members = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM clinic_memberships WHERE "userId" = (SELECT "userId" FROM staff_invitations WHERE id = ${r.invitation.id}::uuid)`;
      expect(members[0].n).toBe(0);
    });
  });

  it("existing and new accounts get the same neutral response (sign-in link for the existing one)", async () => {
    const existingEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [demoId("user:DR-02")])).rows[0].email as string; // an Aarogya doctor
    await inRollback(async ({ tx, as }) => {
      await as(adminB);
      const mailer = existingAccount();
      const existing = await createInvitation(adminB, { ...nurse(existingEmail, demoId("branch:NIR-IND")), roleKey: "RECEPTIONIST" }, tx, { mailer });
      const fresh = await createInvitation(adminB, { ...nurse("zztest.fresh@example.com", demoId("branch:NIR-IND")), roleKey: "RECEPTIONIST" }, tx, { mailer: ok });
      expect(mailer.signInLink).toHaveBeenCalledOnce();
      expect(existing.delivery).toEqual(fresh.delivery);
      expect(Object.keys(existing.invitation).sort()).toEqual(Object.keys(fresh.invitation).sort());
      expect(existing.invitation.delivery).toBe(fresh.invitation.delivery);
      // The other clinic's audit trail shows the same events either way: no users.insert for the new account.
      const events = await tx.$queryRaw<{ action: string }[]>`SELECT action FROM audit_events WHERE "clinicId" = ${FIX.clinicB}::uuid AND action = 'users.insert' AND "occurredAt" > now() - interval '1 minute'`;
      expect(events).toHaveLength(0);
    });
  });

  it("refuses duplicates (case-insensitive), existing members, and patients of the same clinic", async () => {
    const memberEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [demoId("user:ST-04")])).rows[0].email as string;
    const patientEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [demoId("user:PU-01")])).rows[0].email as string;
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const first = await createInvitation(adminA, nurse("zztest.dup@example.com"), tx, { mailer: ok });
      const dup = await attemptIn(tx, () => createInvitation(adminA, nurse(" ZZTEST.DUP@example.COM "), tx, { mailer: ok }));
      expect(dup?.code).toBe("ALREADY_INVITED");
      expect(dup?.details).toEqual({ invitationId: first.invitation.id });
      expect(await codeIn(tx, () => createInvitation(adminA, nurse(memberEmail), tx, { mailer: ok }))).toBe("ALREADY_MEMBER");
      expect(await codeIn(tx, () => createInvitation(adminA, nurse(patientEmail), tx, { mailer: ok }))).toBe("ALREADY_PATIENT");
    });
  });

  it("only administrators may invite, only to active branches of their own clinic, never as Administrator/Patient", async () => {
    await inRollback(async ({ tx, as }) => {
      for (const ctx of [managerWakad, receptionWakad, doctor1]) {
        await as(ctx);
        expect(await codeIn(tx, () => createInvitation(ctx, nurse("zztest.x@example.com"), tx, { mailer: ok }))).toBe("FORBIDDEN");
      }
      await as(adminA);
      expect(await codeIn(tx, () => createInvitation(adminA, { ...nurse("zztest.y@example.com"), roleKey: "ADMINISTRATOR" }, tx, { mailer: ok }))).toBe("ZodError");
      expect(await codeIn(tx, () => createInvitation(adminA, { ...nurse("zztest.y@example.com"), roleKey: "PATIENT" }, tx, { mailer: ok }))).toBe("ZodError");
      expect(await codeIn(tx, () => createInvitation(adminA, nurse("zztest.y@example.com", demoId("branch:NIR-IND")), tx, { mailer: ok }))).toBe("INVALID_INPUT");
      // The database function refuses the same, whatever the API does.
      const direct = await attemptIn(tx, () => tx.$queryRaw`SELECT app.create_staff_invitation('zztest.z@example.com', 'ZZ', 'ADMINISTRATOR', ${FIX.wakad}::uuid, ${PHONE})`);
      expect(direct?.message).toMatch(/ROLE_NOT_INVITABLE/);
    });
  });

  it("clinic managers see their own branch read-only; other clinics see nothing", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const wakad = await createInvitation(adminA, nurse("zztest.w@example.com"), tx, { mailer: ok });
      const kothrud = await createInvitation(adminA, nurse("zztest.k@example.com", FIX.kothrud), tx, { mailer: ok });
      await as(managerWakad);
      const mine = await listInvitations(managerWakad, {}, tx);
      expect(mine.canManage).toBe(false);
      expect(mine.items.map((i) => i.id)).toContain(wakad.invitation.id);
      expect(mine.items.map((i) => i.id)).not.toContain(kothrud.invitation.id);
      expect(mine.items.every((i) => !i.canResend && !i.canRevoke)).toBe(true);
      expect(await codeIn(tx, () => revokeInvitation(managerWakad, wakad.invitation.id, tx))).toBe("FORBIDDEN");
      await as(adminB);
      expect((await listInvitations(adminB, {}, tx)).items.map((i) => i.id)).not.toContain(wakad.invitation.id);
      expect(await codeIn(tx, () => resendInvitation(adminB, wakad.invitation.id, tx, { mailer: ok }))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => revokeInvitation(adminB, wakad.invitation.id, tx))).toBe("NOT_FOUND");
      await as(receptionWakad);
      expect(await codeIn(tx, () => listInvitations(receptionWakad, {}, tx))).toBe("FORBIDDEN");
    });
  });

  it("records email failures without losing the invitation; resend is rate-limited; revoke is final", async () => {
    // deliver() swallows a failure to record the outcome (it only logs), so assert it never happened.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const failed = await createInvitation(adminA, nurse("zztest.fail@example.com"), tx, { mailer: rateLimited });
      expect(failed.delivery).toEqual({ status: "failed", error: "rate_limited" });
      expect(failed.invitation).toMatchObject({ status: "pending", delivery: "failed", deliveryError: "rate_limited" });
      const unconfigured = await createInvitation(adminA, nurse("zztest.noconf@example.com"), tx, { mailer: null });
      expect(unconfigured.delivery).toEqual({ status: "failed", error: "not_configured" });
      expect(await codeIn(tx, () => resendInvitation(adminA, failed.invitation.id, tx, { mailer: ok }))).toBe("TOO_SOON");
      const revoked = await revokeInvitation(adminA, failed.invitation.id, tx);
      expect(revoked.invitation.status).toBe("revoked");
      expect((await revokeInvitation(adminA, failed.invitation.id, tx)).invitation.status).toBe("revoked"); // idempotent
      expect(await codeIn(tx, () => resendInvitation(adminA, failed.invitation.id, tx, { mailer: ok }))).toBe("NOT_PENDING");
    });
    expect(logged.mock.calls.filter(([m]) => String(m).includes("couldn't record delivery outcome"))).toEqual([]);
    logged.mockRestore();
  });

  it("without email configured: the invitation is saved, Resend is refused before anything changes, and nothing is duplicated", async () => {
    const email = "zztest.noemail@example.com";
    const state = (tx: TenantTx) => tx.staffInvitation.findMany({ where: { email }, select: { id: true, sendAttempts: true, lastAttemptAt: true, expiresAt: true, deliveryStatus: true, deliveryError: true } });
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const created = await createInvitation(adminA, nurse(email), tx, { mailer: null });
      expect(created.delivery).toEqual({ status: "failed", error: "not_configured" });
      expect(created.invitation).toMatchObject({ status: "pending", delivery: "failed", deliveryError: "not_configured", sendAttempts: 1 });
      const before = await state(tx);
      expect(before).toHaveLength(1);

      const refused = await attemptIn(tx, () => resendInvitation(adminA, created.invitation.id, tx, { mailer: null }));
      expect(refused?.code).toBe("EMAIL_NOT_CONFIGURED");
      expect(refused?.message).toContain("SUPABASE_SECRET_KEY");
      expect(await state(tx)).toEqual(before); // no attempt used, cooldown and expiry untouched
      // Retrying through "Invite" again can't create a second invitation either.
      expect(await codeIn(tx, () => createInvitation(adminA, nurse(email.toUpperCase()), tx, { mailer: ok }))).toBe("ALREADY_INVITED");
      expect(await state(tx)).toHaveLength(1);

      // The list tells administrators (only) whether this server can send email.
      const { emailSendingConfigured } = await import("@/server/supabase-admin");
      expect((await listInvitations(adminA, {}, tx)).emailConfigured).toBe(emailSendingConfigured());
      await as(managerWakad);
      expect((await listInvitations(managerWakad, {}, tx)).emailConfigured).toBeNull();
    });
  });

  it("invitee journey: first sign-in → invitation page (not Access Denied) → explicit accept → Receptionist at Wakad only", async () => {
    const { noMembershipDestination, resolveTenantContext } = await import("@/server/auth/authorize");
    const email = "zztest.rahul@example.com";
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const invited = await createInvitation(adminA, { ...nurse(email), roleKey: "RECEPTIONIST" }, tx, { mailer: ok });
      // Another clinic's invitation for someone else: must never be disclosed to, or accepted by, this invitee.
      await as(adminB);
      const foreign = await createInvitation(adminB, { ...nurse("zztest.other@example.com", demoId("branch:NIR-IND")), roleKey: "RECEPTIONIST" }, tx, { mailer: ok });

      // 1. First sign-in after setting the password (the account is linked by its confirmed email).
      const who = await signInAs(tx, email, "zz-auth-rahul");
      const signedIn = await identityIn(tx, who);
      expect(signedIn.memberships).toEqual([]);
      expect(() => resolveTenantContext(signedIn)).toThrow(expect.objectContaining({ code: "NO_MEMBERSHIP" }));

      // 2. The staff guard sends them to their invitation, found from the verified session only.
      const pending = (w: VerifiedIdentity) => listMyInvitations(w, tx).then((r) => r.items.length);
      expect(await noMembershipDestination(signedIn, pending)).toBe("/invitations");
      const mine = await listMyInvitations(who, tx);
      expect(mine.items).toEqual([expect.objectContaining({ id: invited.invitation.id, roleKey: "RECEPTIONIST", branchName: expect.stringContaining("Wakad"), expired: false })]);
      expect(mine.items.map((i) => i.id)).not.toContain(foreign.invitation.id);

      // 3. Before accepting: no clinic data at all (RLS), and a wrong email or someone else's invitation is refused.
      await pinUser(tx, who);
      expect(await visibleCounts(tx)).toEqual({ patients: 0, appointments: 0, memberships: 0, invitations: 0 });
      expect((await listMyInvitations({ ...who, verifiedEmail: "someone.else@example.com" }, tx)).items).toEqual([]);
      expect(await codeIn(tx, () => acceptInvitation({ ...who, verifiedEmail: "someone.else@example.com" }, invited.invitation.id, tx))).toBe("EMAIL_MISMATCH");
      expect(await codeIn(tx, () => acceptInvitation(who, foreign.invitation.id, tx))).toBe("NOT_FOUND");
      expect((await identityIn(tx, who)).memberships).toEqual([]);

      // 4. Explicit acceptance creates the membership atomically; the invitation becomes Accepted.
      await pinUser(tx, who);
      expect(await acceptInvitation(who, invited.invitation.id, tx)).toEqual({ clinicId: FIX.clinicA });
      // Accepting again (double click, retry) is harmless: same clinic, still exactly one membership.
      expect(await acceptInvitation(who, invited.invitation.id, tx)).toEqual({ clinicId: FIX.clinicA });
      expect((await identityIn(tx, who)).memberships).toHaveLength(1);
      expect((await listMyInvitations(who, tx)).items).toEqual([]);

      // 5. The refreshed tenant context: Receptionist of Aarogya, Wakad branch only.
      const ctx = resolveTenantContext(await identityIn(tx, who), FIX.clinicA);
      expect(ctx).toMatchObject({ clinicId: FIX.clinicA, branchId: FIX.wakad, roles: ["RECEPTIONIST"], doctorId: null });
      await as(ctx);
      const after = await visibleCounts(tx);
      expect(after.patients).toBeGreaterThan(0);
      const branches = await tx.$queryRaw<{ b: string }[]>`SELECT DISTINCT "branchId"::text AS b FROM appointments`;
      expect(branches.every((r) => r.b === FIX.wakad)).toBe(true);
      await as(adminA);
      expect((await listInvitations(adminA, {}, tx)).items.find((i) => i.id === invited.invitation.id)?.status).toBe("accepted");
      // The phone entered on the invitation is now on the staff record shown in the Staff directory.
      const directory = await listStaff(adminA, { search: email }, tx);
      expect(directory.items).toEqual([expect.objectContaining({ email, phone: PHONE, role: "receptionist", branchId: FIX.wakad })]);
    });
  });

  it("a revoked invitation isn't offered: the invitee keeps the normal Access Denied page and can't accept it", async () => {
    const { noMembershipDestination } = await import("@/server/auth/authorize");
    const email = "zztest.revoked@example.com";
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const inv = await createInvitation(adminA, nurse(email), tx, { mailer: ok });
      await revokeInvitation(adminA, inv.invitation.id, tx);
      const who = await signInAs(tx, email, "zz-auth-revoked");
      expect(await noMembershipDestination(await identityIn(tx, who), (w) => listMyInvitations(w, tx).then((r) => r.items.length))).toBeNull();
      await pinUser(tx, who);
      expect(await codeIn(tx, () => acceptInvitation(who, inv.invitation.id, tx))).toBe("REVOKED");
      expect((await identityIn(tx, who)).memberships).toEqual([]);
    });
  });

  it("phone: required and validated (nothing is created for an invalid one; the number is never echoed), stored in E.164", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      for (const phone of [undefined, "", "98000 00001", "+91 18000 00001", "+91 98000 0000", "+1 555 0100", "+9198000000012345678"]) {
        const e = await attemptIn(tx, () => createInvitation(adminA, { ...nurse("zztest.badphone@example.com"), phone }, tx, { mailer: ok }));
        expect(e?.name, String(phone)).toBe("ZodError");
        expect(JSON.stringify(e)).not.toMatch(/98000|18000|0100/);
      }
      expect(await tx.staffInvitation.count({ where: { email: "zztest.badphone@example.com" } })).toBe(0);
      // Any spelling of a valid number is stored the same way.
      const r = await createInvitation(adminA, { ...nurse("zztest.goodphone@example.com"), phone: "0091 98000-00001" }, tx, { mailer: ok });
      expect((await tx.staffInvitation.findUnique({ where: { id: r.invitation.id }, select: { phone: true } }))?.phone).toBe(PHONE);
      // The database refuses a malformed phone on its own (defence in depth), without the number in the message.
      const direct = await attemptIn(tx, () => tx.$queryRaw`SELECT app.create_staff_invitation('zztest.direct@example.com', 'ZZ', 'NURSE', ${FIX.wakad}::uuid, '98000 00001')`);
      expect(direct?.message).toMatch(/staff invitation: INVALID_PHONE/);
      expect(direct?.message).not.toMatch(/98000/);
    });
  });

  it("limits each clinic to 50 new invitations per hour", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      // Real invitations created in the last hour count towards the limit too.
      const [{ n: recent }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM staff_invitations WHERE "clinicId" = ${FIX.clinicA}::uuid AND "createdAt" > now() - interval '1 hour'`;
      for (let i = recent; i < 50; i++) await tx.$queryRaw`SELECT app.create_staff_invitation(${`zztest.rl${i}@example.com`}, 'ZZTEST RL', 'NURSE', ${FIX.wakad}::uuid, ${PHONE})`;
      expect(await codeIn(tx, () => createInvitation(adminA, nurse("zztest.rl50@example.com"), tx, { mailer: ok }))).toBe("RATE_LIMITED");
    });
  }, 120_000);

  it("doctor registration numbers are unique per clinic (seeded doctors and pending invitations)", async () => {
    const specialtyId = (await admin.query(`SELECT id FROM specialties ORDER BY name LIMIT 1`)).rows[0].id as string;
    const seededReg = (await admin.query(`SELECT "registrationNumber" r FROM doctor_profiles WHERE id = $1`, [FIX.doctor1])).rows[0].r as string;
    const doc = (email: string, reg: string) => ({ email, name: "ZZTEST Doctor", roleKey: "DOCTOR", branchId: FIX.wakad, phone: PHONE, doctor: { specialtyId, qualifications: "MBBS", registrationNumber: reg, experienceYears: 3, consultationFee: 500, onlineConsultation: false } });
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await codeIn(tx, () => createInvitation(adminA, doc("zztest.d1@example.com", seededReg.toLowerCase()), tx, { mailer: ok }))).toBe("REGISTRATION_IN_USE");
      await createInvitation(adminA, doc("zztest.d2@example.com", "ZZTEST-REG-1"), tx, { mailer: ok });
      expect(await codeIn(tx, () => createInvitation(adminA, doc("zztest.d3@example.com", "zztest-reg-1"), tx, { mailer: ok }))).toBe("REGISTRATION_IN_USE");
    });
  });

  it("a doctor has NO clinical access while invited, and only their own branch-scoped access after accepting", async () => {
    const specialtyId = (await admin.query(`SELECT id FROM specialties ORDER BY name LIMIT 1`)).rows[0].id as string;
    const doctorPerms = (await admin.query(`SELECT p.key FROM role_permissions rp JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId" WHERE r.key = 'DOCTOR'`)).rows.map((r) => r.key as string);
    const patient = (await admin.query(`SELECT id, name FROM patients WHERE "clinicId" = $1 AND "branchId" = $2 ORDER BY "patientNumber" LIMIT 1`, [FIX.clinicA, FIX.wakad])).rows[0] as { id: string; name: string };
    const email = "zztest.newdoctor@example.com";
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const inv = await createInvitation(
        adminA,
        { email, name: "ZZTEST New Doctor", roleKey: "DOCTOR", branchId: FIX.wakad, phone: PHONE, doctor: { specialtyId, qualifications: "MBBS, MD", registrationNumber: "ZZTEST-REG-77", experienceYears: 6, consultationFee: 750.5, onlineConsultation: true } },
        tx,
        { mailer: ok }
      );
      expect(inv.invitation.doctor).toMatchObject({ registrationNumber: "ZZTEST-REG-77" });

      const who = await signInAs(tx, email, "zztest-auth-newdoctor");
      // Pending: no membership, no doctor profile, and nothing visible even with a forged clinic context.
      const pendingCtx: TenantContext = { authUserId: who.authUserId, userId: who.userId, email, name: "ZZTEST", clinicId: FIX.clinicA, clinicName: "", branchId: FIX.wakad, roles: ["DOCTOR"], permissions: new Set(doctorPerms), doctorId: null, careScope: "own" };
      await as(pendingCtx);
      const visible = await tx.$queryRaw<{ n: number }[]>`SELECT ((SELECT count(*) FROM patients) + (SELECT count(*) FROM appointments) + (SELECT count(*) FROM consultations) + (SELECT count(*) FROM prescriptions) + (SELECT count(*) FROM doctor_profiles WHERE "userId" = ${who.userId}::uuid))::int AS n`;
      expect(visible[0].n).toBe(0);

      await pinUser(tx, who);
      expect((await listMyInvitations(who, tx)).items.map((i) => i.id)).toEqual([inv.invitation.id]);
      expect(await codeIn(tx, () => acceptInvitation({ ...who, verifiedEmail: "someone.else@example.com" }, inv.invitation.id, tx))).toBe("EMAIL_MISMATCH");
      const accepted = await acceptInvitation(who, inv.invitation.id, tx);
      expect(accepted.clinicId).toBe(FIX.clinicA);
      expect((await acceptInvitation(who, inv.invitation.id, tx)).clinicId).toBe(FIX.clinicA); // repeat is harmless

      await as(adminA);
      const rows = await tx.$queryRaw<{ memberships: number; branch: string | null; profile: string | null; fee: number | null; branches: string[] | null }[]>`
        SELECT (SELECT count(*)::int FROM clinic_memberships WHERE "userId" = ${who.userId}::uuid) AS memberships,
               (SELECT "branchId"::text FROM clinic_memberships WHERE "userId" = ${who.userId}::uuid) AS branch,
               (SELECT id::text FROM doctor_profiles WHERE "userId" = ${who.userId}::uuid) AS profile,
               (SELECT "consultationFeePaise" FROM doctor_profiles WHERE "userId" = ${who.userId}::uuid) AS fee,
               (SELECT array_agg("branchId"::text) FROM doctor_branches WHERE "doctorId" = (SELECT id FROM doctor_profiles WHERE "userId" = ${who.userId}::uuid)) AS branches`;
      expect(rows[0]).toMatchObject({ memberships: 1, branch: FIX.wakad, fee: 75050, branches: [FIX.wakad] });
      const doctorId = rows[0].profile!;
      expect((await listInvitations(adminA, { status: "accepted" }, tx)).items.map((i) => i.id)).toContain(inv.invitation.id);
      // The inviter is notified (no names: role and branch only).
      const notes = await listNotifications(adminA, {}, tx);
      const joined = notes.items.find((n) => n.type === "staff_invitation_accepted");
      expect(joined?.body).toMatch(/^A new Doctor joined at .+\.$/);
      expect(joined?.body).not.toContain("ZZTEST");

      // Book one appointment with the new doctor at Wakad (their branch); Kothrud (not theirs) is refused.
      await as(receptionWakad);
      const date = [3, 4].map(istDate).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0)!;
      await createAppointment(receptionWakad, { patientId: patient.id, doctorId, branchId: FIX.wakad, date, time: "11:00", type: "in_person", reason: "ZZTEST visit" }, tx);
      await as(adminA);
      expect(await codeIn(tx, () => createAppointment(adminA, { patientId: patient.id, doctorId, branchId: FIX.kothrud, date, time: "11:30", type: "in_person", reason: "ZZTEST visit" }, tx))).not.toBe("OK");

      const doctorCtx: TenantContext = { ...pendingCtx, doctorId, careScope: "own" };
      await as(doctorCtx);
      const theirs = await listAppointments(doctorCtx, {}, tx);
      expect(theirs.items.length).toBe(1);
      expect(theirs.items.every((a) => a.doctorId === doctorId)).toBe(true);
      // Booking notified the doctor — without the patient's name or the visit reason.
      const docNotes = await listNotifications(doctorCtx, {}, tx);
      const booked = docNotes.items.find((n) => n.type === "appointment_booked");
      expect(booked).toBeDefined();
      expect(`${booked?.title} ${booked?.body}`).not.toContain(patient.name);
      expect(`${booked?.title} ${booked?.body}`).not.toContain("ZZTEST visit");
      // A forged branch outside their membership sees nothing.
      await as({ ...doctorCtx, branchId: FIX.kothrud });
      const forged = await tx.$queryRaw<{ n: number }[]>`SELECT ((SELECT count(*) FROM appointments) + (SELECT count(*) FROM patients))::int AS n`;
      expect(forged[0].n).toBe(0);
    });
  }, 120_000);

  it("someone else's invitation id is indistinguishable from a missing one", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const a = await createInvitation(adminA, nurse("zztest.owner@example.com"), tx, { mailer: ok });
      await createInvitation(adminA, nurse("zztest.other@example.com"), tx, { mailer: ok });
      const other = await signInAs(tx, "zztest.other@example.com", "zztest-auth-other");
      expect(await codeIn(tx, () => acceptInvitation(other, a.invitation.id, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => acceptInvitation(other, "00000000-0000-4000-8000-000000000000", tx))).toBe("NOT_FOUND");
      expect((await listMyInvitations(other, tx)).items.map((i) => i.id)).not.toContain(a.invitation.id);
    });
  });
});

// Time-dependent rules (cooldown, expiry) and the one-doctor-profile rule, run
// through the database functions on the admin connection so timestamps can be
// moved inside the transaction. Everything is rolled back.
describe.skipIf(!APPLIED)("invitation function rules (admin connection, rolled back)", () => {
  async function adminTx(fn: (q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>, pin: (user: string, clinic: string, auth?: string) => Promise<void>) => Promise<void>) {
    await admin.query("BEGIN");
    try {
      const q = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows;
      const pin = async (user: string, clinic: string, auth = "") => {
        await admin.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', '', true), set_config('app.auth_user_id', $3, true)`, [user, clinic, auth]);
      };
      await fn(q, pin);
    } finally {
      await admin.query("ROLLBACK");
    }
  }
  /** Runs SQL that may be refused inside a SAVEPOINT, so the surrounding rolled-back transaction stays usable. */
  const fails = async (sql: string, params: unknown[] = []) => {
    await admin.query("SAVEPOINT p5_rule");
    try {
      await admin.query(sql, params);
      await admin.query("RELEASE SAVEPOINT p5_rule");
      return "OK";
    } catch (e) {
      await admin.query("ROLLBACK TO SAVEPOINT p5_rule");
      return (e as Error).message;
    }
  };

  it("resend: 2-minute cooldown, extends expiry by 7 days, at most 10 sends", async () => {
    await adminTx(async (q, pin) => {
      await pin(demoId("user:ST-01"), FIX.clinicA);
      const [{ id }] = await q(`SELECT app.create_staff_invitation('zztest.cool@example.com', 'ZZ', 'NURSE', $1, '+919800000001') AS id`, [FIX.wakad]);
      expect(await fails(`SELECT app.resend_staff_invitation($1)`, [id])).toMatch(/TOO_SOON/);
      await q(`UPDATE staff_invitations SET "lastAttemptAt" = now() - interval '3 minutes', "expiresAt" = now() + interval '1 day' WHERE id = $1`, [id]);
      await q(`SELECT app.resend_staff_invitation($1)`, [id]);
      const [row] = await q(`SELECT "sendAttempts", extract(epoch FROM "expiresAt" - now())::int AS secs FROM staff_invitations WHERE id = $1`, [id]);
      expect(row.sendAttempts).toBe(2);
      expect(Math.abs(Number(row.secs) - 7 * 86400)).toBeLessThan(120);
      await q(`UPDATE staff_invitations SET "lastAttemptAt" = now() - interval '3 minutes', "sendAttempts" = 10 WHERE id = $1`, [id]);
      expect(await fails(`SELECT app.resend_staff_invitation($1)`, [id])).toMatch(/TOO_MANY_ATTEMPTS/);
    });
  });

  it("acceptance copies the phone onto an account without one, and never overwrites an existing phone", async () => {
    await adminTx(async (q, pin) => {
      await pin(demoId("user:ST-01"), FIX.clinicA);
      const [{ id: fresh }] = await q(`SELECT app.create_staff_invitation('zztest.ph1@example.com', 'ZZ', 'NURSE', $1, '+919800000011') AS id`, [FIX.wakad]);
      const [{ id: hasPhone }] = await q(`SELECT app.create_staff_invitation('zztest.ph2@example.com', 'ZZ', 'NURSE', $1, '+919800000012') AS id`, [FIX.wakad]);
      // Simulate first sign-in; the second account already has its own phone (e.g. shown by another clinic).
      await q(`UPDATE users SET "authProviderId" = 'zz-ph1', status = 'ACTIVE' WHERE email = 'zztest.ph1@example.com'`);
      await q(`UPDATE users SET "authProviderId" = 'zz-ph2', status = 'ACTIVE', phone = '+919800000099' WHERE email = 'zztest.ph2@example.com'`);
      const userOf = async (email: string) => (await q(`SELECT id, phone FROM users WHERE email = $1`, [email]))[0] as { id: string; phone: string | null };
      await pin((await userOf("zztest.ph1@example.com")).id, "", "zz-ph1");
      await q(`SELECT app.accept_staff_invitation($1, 'zztest.ph1@example.com')`, [fresh]);
      await pin((await userOf("zztest.ph2@example.com")).id, "", "zz-ph2");
      await q(`SELECT app.accept_staff_invitation($1, 'zztest.ph2@example.com')`, [hasPhone]);
      expect((await userOf("zztest.ph1@example.com")).phone).toBe("+919800000011");
      expect((await userOf("zztest.ph2@example.com")).phone).toBe("+919800000099");
      // Audit and notifications record that the phone changed, never the number.
      const leaked = await q(`SELECT count(*)::int AS n FROM audit_events WHERE metadata::text LIKE '%98000000%'`);
      const notified = await q(`SELECT count(*)::int AS n FROM notifications WHERE data::text LIKE '%98000000%'`);
      expect([leaked[0].n, notified[0].n]).toEqual([0, 0]);
    });
  });

  it("expired and revoked invitations can't be accepted", async () => {
    await adminTx(async (q, pin) => {
      await pin(demoId("user:ST-01"), FIX.clinicA);
      const [{ id: expired }] = await q(`SELECT app.create_staff_invitation('zztest.exp@example.com', 'ZZ', 'NURSE', $1, '+919800000001') AS id`, [FIX.wakad]);
      const [{ id: revoked }] = await q(`SELECT app.create_staff_invitation('zztest.rev@example.com', 'ZZ', 'NURSE', $1, '+919800000001') AS id`, [FIX.wakad]);
      await q(`SELECT app.revoke_staff_invitation($1)`, [revoked]);
      await q(`UPDATE staff_invitations SET "expiresAt" = now() - interval '1 second' WHERE id = $1`, [expired]);
      for (const [email, auth] of [["zztest.exp@example.com", "zz-exp"], ["zztest.rev@example.com", "zz-rev"]]) {
        await q(`UPDATE users SET "authProviderId" = $1, status = 'ACTIVE' WHERE email = $2`, [auth, email]);
      }
      const userOf = async (email: string) => (await q(`SELECT id FROM users WHERE email = $1`, [email]))[0].id as string;
      await pin(await userOf("zztest.exp@example.com"), "", "zz-exp");
      expect(await fails(`SELECT app.accept_staff_invitation($1, 'zztest.exp@example.com')`, [expired])).toMatch(/EXPIRED/);
      await pin(await userOf("zztest.rev@example.com"), "", "zz-rev");
      expect(await fails(`SELECT app.accept_staff_invitation($1, 'zztest.rev@example.com')`, [revoked])).toMatch(/REVOKED/);
      expect((await q(`SELECT count(*)::int AS n FROM clinic_memberships WHERE "userId" IN ($1, $2)`, [await userOf("zztest.exp@example.com"), await userOf("zztest.rev@example.com")]))[0].n).toBe(0);
    });
  });

  it("one doctor profile per person: a doctor elsewhere can't accept a Doctor invitation, and the inviter learns nothing", async () => {
    const dr2 = (await admin.query(`SELECT u.id, u.email FROM users u WHERE u.id = $1`, [demoId("user:DR-02")])).rows[0] as { id: string; email: string };
    const nirSpecialty = (await admin.query(`SELECT id FROM specialties ORDER BY name LIMIT 1`)).rows[0].id as string;
    await adminTx(async (q, pin) => {
      await pin(demoId("user:ST-07"), FIX.clinicB);
      const [{ id }] = await q(`SELECT app.create_staff_invitation($1, 'ZZ', 'DOCTOR', $2, '+919800000002', $3, 'MBBS', 'ZZTEST-NIR-1', 4, 40000, false) AS id`, [dr2.email, demoId("branch:NIR-IND"), nirSpecialty]);
      expect(id).toBeTruthy(); // created like any other invitation
      await q(`UPDATE users SET "authProviderId" = 'zz-dr2', status = 'ACTIVE' WHERE id = $1`, [dr2.id]);
      await pin(dr2.id, "", "zz-dr2");
      expect(await fails(`SELECT app.accept_staff_invitation($1, $2)`, [id, dr2.email])).toMatch(/DOCTOR_PROFILE_EXISTS/);
    });
  });
});

describe.skipIf(!APPLIED)("concurrent invitations (two connections, both rolled back)", () => {
  it("a second create for the same email waits for the first (serialised), so duplicates can't race", async () => {
    const c1 = new Client(verifiedPgConfig(process.env.DATABASE_URL!));
    const c2 = new Client(verifiedPgConfig(process.env.DATABASE_URL!));
    await c1.connect();
    await c2.connect();
    const pin = (c: Client) => c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', '', true)`, [demoId("user:ST-01"), FIX.clinicA]);
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      await pin(c1);
      await pin(c2);
      await c1.query(`SELECT app.create_staff_invitation('zztest.race@example.com', 'ZZ', 'NURSE', $1, '+919800000001')`, [FIX.wakad]);
      await c2.query(`SET LOCAL lock_timeout = '1500ms'`);
      const second = await c2.query(`SELECT app.create_staff_invitation('ZZTEST.Race@example.com', 'ZZ', 'NURSE', $1, '+919800000001')`, [FIX.wakad]).then(() => "OK", (e: Error) => e.message);
      expect(second).toMatch(/lock timeout/i);
    } finally {
      await c1.query("ROLLBACK").catch(() => {});
      await c2.query("ROLLBACK").catch(() => {});
      await c1.end();
      await c2.end();
    }
  });
});

describe.skipIf(!APPLIED)("retrying a failed email (data layer on the admin connection, rolled back)", () => {
  // now() is fixed within a transaction, so the 2-minute cooldown can only be passed by
  // backdating the last attempt — which the runtime role may not do. This suite runs the
  // real data-layer functions on an admin-connection client instead, and rolls back.
  it("Resend after the cooldown re-sends the SAME invitation and records each outcome", async () => {
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { pinTenantContext } = await import("@/server/db/tenant");
    const adminPrisma = new PrismaClient({ adapter: new PrismaPg(verifiedPgConfig(process.env.DIRECT_URL!)) });
    const email = "zztest.retry@example.com";
    const sent = vi.fn(async () => ({ error: null }));
    const smtpBroken: InvitationMailer = { invite: async () => ({ error: { code: "unexpected_failure", status: 500 } }), signInLink: async () => ({ error: null }) };
    try {
      await adminPrisma.$transaction(async (tx) => {
        await pinTenantContext(tx, adminA);
        const backdate = () => tx.$executeRaw`UPDATE staff_invitations SET "lastAttemptAt" = now() - interval '3 minutes' WHERE email = ${email}`;
        const rows = () => tx.staffInvitation.findMany({ where: { email }, select: { id: true, phone: true, sendAttempts: true, deliveryStatus: true, deliveryError: true } });

        const first = await createInvitation(adminA, nurse(email), tx, { mailer: rateLimited });
        expect(first.invitation).toMatchObject({ delivery: "failed", deliveryError: "rate_limited", sendAttempts: 1, canResend: false });
        // Within the cooldown: refused, and no attempt is used.
        expect(await codeIn(tx, () => resendInvitation(adminA, first.invitation.id, tx, { mailer: { invite: sent, signInLink: sent } }))).toBe("TOO_SOON");
        expect(sent).not.toHaveBeenCalled();

        await backdate();
        const retried = await resendInvitation(adminA, first.invitation.id, tx, { mailer: { invite: sent, signInLink: sent } });
        expect(sent).toHaveBeenCalledWith(email);
        expect(retried.delivery).toEqual({ status: "sent" });
        expect(retried.invitation).toMatchObject({ id: first.invitation.id, status: "pending", delivery: "sent", deliveryError: null, sendAttempts: 2 });

        await backdate();
        const broken = await resendInvitation(adminA, first.invitation.id, tx, { mailer: smtpBroken });
        expect(broken.delivery).toEqual({ status: "failed", error: "send_failed" });
        expect(await rows()).toEqual([{ id: first.invitation.id, phone: PHONE, sendAttempts: 3, deliveryStatus: "FAILED", deliveryError: "send_failed" }]);
        throw new Error("rollback");
      }, { timeout: 60_000 }).catch((e: Error) => { if (e.message !== "rollback") throw e; });
    } finally {
      await adminPrisma.$disconnect();
    }
  });
});

describe.runIf(!APPLIED)("before the invitation migrations (and fix) are applied", () => {
  it("creating an invitation is refused as 'not set up' — nothing is created or emailed", async () => {
    const send = vi.fn(async () => ({ error: null }));
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await codeIn(tx, () => createInvitation(adminA, nurse("zztest.notready@example.com"), tx, { mailer: { invite: send, signInLink: send } }))).toBe("FEATURE_UNAVAILABLE");
      if (!TABLES) expect(await codeIn(tx, () => listInvitations(adminA, {}, tx))).toBe("FEATURE_UNAVAILABLE");
    });
    expect(send).not.toHaveBeenCalled();
    expect((await admin.query(`SELECT count(*)::int AS n FROM users WHERE email = 'zztest.notready@example.com'`)).rows[0].n).toBe(0);
  });
});

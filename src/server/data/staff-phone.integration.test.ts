import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { listStaff, setStaffPhone, updateStaffMember } from "./people";

// Staff directory "Edit phone" against the live database (migration
// 20261020000100_staff_phone_edit, app.set_staff_phone). Skipped until that
// migration is applied, except the "not set up" check. Every write runs inside
// a transaction that is rolled back; table checksums are compared afterwards.
// Phone numbers are fictional ("+91 98000 0xxxx") and never sent anywhere.

const probe = adminClient();
await probe.connect();
const READY = Boolean((await probe.query(
  `SELECT coalesce((SELECT position('P5-PHONE-EDIT-1' IN prosrc) > 0 FROM pg_proc WHERE oid = to_regprocedure('app.set_staff_phone(uuid, text)')), false) AS ok`
)).rows[0].ok);
await probe.end();

let admin: Client;
let adminA: TenantContext, adminB: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext;
let receptionMembership: string, patientMembership: string | undefined;
let fingerprint = "";

const snapshot = async () =>
  (await admin.query(`SELECT (SELECT count(*) FROM audit_events) || '/' ||
     (SELECT md5(coalesce(string_agg(md5(u::text), '' ORDER BY md5(u::text)), '')) FROM users u) || '/' ||
     (SELECT md5(coalesce(string_agg(md5(m::text), '' ORDER BY md5(m::text)), '')) FROM clinic_memberships m) AS s`)).rows[0].s as string;

type Failure = { code?: string; name?: string; message: string };
/** An expected refusal inside a SAVEPOINT, so the rolled-back transaction stays usable. */
async function codeIn(tx: TenantTx, fn: () => Promise<unknown>): Promise<string> {
  await tx.$executeRawUnsafe("SAVEPOINT phone_attempt");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT phone_attempt");
    return "OK";
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT phone_attempt");
    const f = e as Failure;
    return f.code ?? f.name ?? "ERROR";
  }
}

const phoneOf = (tx: TenantTx, userId: string) => tx.$queryRaw<{ phone: string | null }[]>`SELECT phone FROM users WHERE id = ${userId}::uuid`.then((r) => r[0]?.phone ?? null);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  adminB = await contextFor(admin, "ST-07");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  receptionMembership = (await admin.query(`SELECT id FROM clinic_memberships WHERE "userId" = $1 AND "clinicId" = $2`, [receptionWakad.userId, FIX.clinicA])).rows[0].id;
  patientMembership = (await admin.query(
    `SELECT m.id FROM clinic_memberships m JOIN roles r ON r.id = m."roleId" WHERE m."clinicId" = $1 AND r.key = 'PATIENT' LIMIT 1`, [FIX.clinicA]
  )).rows[0]?.id;
  fingerprint = await snapshot();
});

afterAll(async () => {
  expect(await snapshot()).toBe(fingerprint); // nothing persisted
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe.skipIf(!READY)("edit phone (data layer, rolled back)", () => {
  it("an Administrator sets a staff member's phone: stored in E.164 and shown in the Staff directory", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await updateStaffMember(adminA, receptionMembership, { phone: "+91 98000-00021" }, tx)).toEqual({ id: receptionMembership, phone: "+919800000021" });
      const row = (await listStaff(adminA, { search: receptionWakad.email }, tx)).items.find((m) => m.id === receptionMembership);
      expect(row).toMatchObject({ phone: "+919800000021", canEditPhone: true });
      // Setting the same number again is harmless.
      expect(await setStaffPhone(adminA, receptionMembership, { phone: "+919800000021" }, tx)).toEqual({ id: receptionMembership, phone: "+919800000021" });
    });
  });

  it("only Administrators: Clinic Managers and Receptionists are refused, nothing changes", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const before = await phoneOf(tx, receptionWakad.userId);
      for (const who of [managerWakad, receptionWakad]) {
        await as(who);
        expect(await codeIn(tx, () => setStaffPhone(who, receptionMembership, { phone: "+919800000022" }, tx)), who.name).toBe("FORBIDDEN");
      }
      await as(adminA);
      expect(await phoneOf(tx, receptionWakad.userId)).toBe(before);
      // The directory offers the action to Administrators only.
      await as(managerWakad);
      expect((await listStaff(managerWakad, {}, tx)).items.every((m) => !m.canEditPhone)).toBe(true);
    });
  });

  it("another clinic's administrator, a patient membership and a missing id all look the same (NOT_FOUND)", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminB);
      expect(await codeIn(tx, () => setStaffPhone(adminB, receptionMembership, { phone: "+919800000023" }, tx))).toBe("NOT_FOUND");
      await as(adminA);
      if (patientMembership) expect(await codeIn(tx, () => setStaffPhone(adminA, patientMembership!, { phone: "+919800000023" }, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => setStaffPhone(adminA, "00000000-0000-4000-8000-000000000000", { phone: "+919800000023" }, tx))).toBe("NOT_FOUND");
      expect(await codeIn(tx, () => setStaffPhone(adminA, "not-a-uuid", { phone: "+919800000023" }, tx))).toBe("NOT_FOUND");
    });
  });

  it("invalid numbers are refused before the database, without echoing them", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const before = await phoneOf(tx, receptionWakad.userId);
      for (const phone of ["", "98000 00001", "+91 18000 00001", "+91 98000 0000", "+91 98000 0000x"]) {
        expect(await codeIn(tx, () => setStaffPhone(adminA, receptionMembership, { phone }, tx)), phone).toBe("ZodError");
      }
      expect(await codeIn(tx, () => setStaffPhone(adminA, receptionMembership, { phone: "+919800000024", extra: true }, tx))).toBe("ZodError");
      expect(await phoneOf(tx, receptionWakad.userId)).toBe(before);
    });
  });
});

describe.skipIf(!READY)("app.set_staff_phone rules (admin connection, rolled back)", () => {
  async function adminTx(fn: () => Promise<void>) {
    await admin.query("BEGIN");
    try {
      await fn();
    } finally {
      await admin.query("ROLLBACK");
    }
  }
  const pin = (user: string, clinic: string, branch = "") =>
    admin.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true), set_config('app.auth_user_id', '', true)`, [user, clinic, branch]);
  const fails = async (sql: string, params: unknown[]) => {
    await admin.query("SAVEPOINT phone_rule");
    try {
      await admin.query(sql, params);
      await admin.query("RELEASE SAVEPOINT phone_rule");
      return "OK";
    } catch (e) {
      await admin.query("ROLLBACK TO SAVEPOINT phone_rule");
      return (e as Error).message;
    }
  };
  const phone = async (userId: string) => (await admin.query(`SELECT phone FROM users WHERE id = $1`, [userId])).rows[0].phone as string | null;

  it("a person who also belongs to another clinic (staff or patient) can't have their shared phone changed", async () => {
    await adminTx(async () => {
      const before = await phone(receptionWakad.userId);
      const role = (await admin.query(`SELECT id FROM roles WHERE key = 'RECEPTIONIST'`)).rows[0].id;
      await admin.query(`SAVEPOINT shared`);
      await admin.query(`INSERT INTO clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'INACTIVE', now())`,
        [receptionWakad.userId, FIX.clinicB, demoId("branch:NIR-IND"), role]);
      await pin(adminA.userId, FIX.clinicA);
      const msg = await fails(`SELECT app.set_staff_phone($1, '+919800000031')`, [receptionMembership]);
      expect(msg).toMatch(/staff phone: SHARED_ACCOUNT/);
      expect(msg).not.toMatch(/98000/);
      await admin.query(`ROLLBACK TO SAVEPOINT shared`);

      // A linked patient record at another clinic counts too.
      const otherPatient = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NULL LIMIT 1`, [FIX.clinicB])).rows[0]?.id;
      if (otherPatient) {
        await admin.query(`UPDATE patients SET "userId" = $1 WHERE id = $2`, [receptionWakad.userId, otherPatient]);
        await pin(adminA.userId, FIX.clinicA);
        expect(await fails(`SELECT app.set_staff_phone($1, '+919800000032')`, [receptionMembership])).toMatch(/SHARED_ACCOUNT/);
      }
      expect(await phone(receptionWakad.userId)).toBe(before);
    });
  });

  it("branch scope: an administrator pinned to another branch can't edit a Wakad member", async () => {
    await adminTx(async () => {
      await pin(adminA.userId, FIX.clinicA, FIX.kothrud);
      expect(await fails(`SELECT app.set_staff_phone($1, '+919800000033')`, [receptionMembership])).toMatch(/staff phone: NOT_FOUND/);
      await pin(adminA.userId, FIX.clinicA, FIX.wakad);
      expect(await fails(`SELECT app.set_staff_phone($1, '+919800000033')`, [receptionMembership])).toBe("OK");
    });
  });

  it("the database refuses a malformed number on its own, without echoing it", async () => {
    await adminTx(async () => {
      await pin(adminA.userId, FIX.clinicA);
      const msg = await fails(`SELECT app.set_staff_phone($1, '98000 00001')`, [receptionMembership]);
      expect(msg).toMatch(/staff phone: INVALID_PHONE/);
      expect(msg).not.toMatch(/98000/);
    });
  });

  it("audit: a 'staff.phone_updated' event and a users change naming only the column — never the number", async () => {
    await adminTx(async () => {
      // occurredAt is the transaction's start time, so new events are found by id, not by time.
      const seen = (await admin.query(`SELECT id FROM audit_events`)).rows.map((r) => r.id);
      await pin(adminA.userId, FIX.clinicA);
      expect(await fails(`SELECT app.set_staff_phone($1, '+919800000034')`, [receptionMembership])).toBe("OK");
      const events = (await admin.query(`SELECT action, "clinicId", "actorUserId", metadata FROM audit_events WHERE NOT (id = ANY ($1)) ORDER BY "occurredAt"`, [seen])).rows;
      expect(events.length).toBeGreaterThan(0);
      expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["staff.phone_updated", "users.update"]));
      expect(events.find((e) => e.action === "users.update")?.metadata).toMatchObject({ changed: ["phone"] });
      for (const e of events) {
        expect(JSON.stringify(e)).not.toMatch(/98000|9800000034/);
        expect(e.clinicId).toBe(FIX.clinicA);
        expect(e.actorUserId).toBe(adminA.userId);
      }
      // Nothing about it reaches notifications.
      expect((await admin.query(`SELECT count(*)::int AS n FROM notifications WHERE data::text LIKE '%98000%'`)).rows[0].n).toBe(0);
    });
  });
});

describe("Staff directory phone search (no migration needed; admin connection, rolled back)", () => {
  // The runtime role can't write users.phone, so an admin-connection client stores an
  // E.164 number inside a transaction that is always rolled back, and the real
  // listStaff runs in that same transaction.
  it("typing '98765 43210' (or '+91 98765 43210', '098765-43210') finds a number stored as +919876543210", async () => {
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { verifiedPgConfig } = await import("@/server/db/tls");
    const { pinTenantContext } = await import("@/server/db/tenant");
    const adminPrisma = new PrismaClient({ adapter: new PrismaPg(verifiedPgConfig(process.env.DIRECT_URL!)) });
    try {
      await adminPrisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE users SET phone = '+919800099887' WHERE id = ${receptionWakad.userId}::uuid`;
          await pinTenantContext(tx, adminA);
          for (const search of ["98000 99887", "+91 98000 99887", "098000-99887", "99887"]) {
            const ids = (await listStaff(adminA, { search }, tx)).items.map((m) => m.id);
            expect(ids, search).toEqual([receptionMembership]);
          }
          // Names and emails still search as before; unrelated digits find nothing.
          expect((await listStaff(adminA, { search: receptionWakad.name }, tx)).items.map((m) => m.id)).toContain(receptionMembership);
          expect((await listStaff(adminA, { search: "11223 34455" }, tx)).items).toEqual([]);
          throw new Error("rollback");
        }, { timeout: 60_000 })
        .catch((e: Error) => {
          if (e.message !== "rollback") throw e;
        });
    } finally {
      await adminPrisma.$disconnect();
    }
  });
});

describe.runIf(!READY)("before migration 20261020000100 is applied", () => {
  it("Edit phone reports 'not set up' and changes nothing; the directory doesn't offer it", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const before = await phoneOf(tx, receptionWakad.userId);
      expect(await codeIn(tx, () => setStaffPhone(adminA, receptionMembership, { phone: "+919800000041" }, tx))).toBe("FEATURE_UNAVAILABLE");
      expect(await phoneOf(tx, receptionWakad.userId)).toBe(before);
      const page = await listStaff(adminA, {}, tx);
      expect(page.capabilities.canEditPhone).toBe(false);
      expect(page.items.every((m) => !m.canEditPhone)).toBe(true);
    });
  });
});

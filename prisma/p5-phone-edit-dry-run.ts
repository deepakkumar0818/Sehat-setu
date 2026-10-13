// DRY RUN of 20261020000100_staff_phone_edit — run only with explicit approval.
//
//   npm run db:p5-phone-edit-dry-run
//
// Executes the migration inside ONE transaction on the admin connection
// (DIRECT_URL), exercises app.set_staff_phone with fictional numbers, then
// ALWAYS rolls back: nothing is committed or recorded in _prisma_migrations.
// Every table is re-read afterwards to prove nothing changed. Numbers are never printed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { demoId } from "./seed/demo-data";
import { tableFingerprints } from "./p5-preflight";

config({ path: [".env.local", ".env"], quiet: true });

const NAME = "20261020000100_staff_phone_edit";
const FN = "app.set_staff_phone(uuid, text)";

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const c = new Client(verifiedPgConfig(url));
  await c.connect();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  const attempt = async (sql: string, params: unknown[] = []) => {
    await c.query("SAVEPOINT dry");
    try {
      await c.query(sql, params);
      await c.query("RELEASE SAVEPOINT dry");
      return "OK";
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT dry");
      return (e as Error).message;
    }
  };
  const pin = (user: string, clinic: string, branch = "") =>
    c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true), set_config('app.auth_user_id', '', true)`, [user, clinic, branch]);
  try {
    if ((await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount) throw new Error(`${NAME} is already applied; nothing to dry-run.`);
    const before = await tableFingerprints(c, ["_prisma_migrations"]);
    const clinicA = demoId("clinic:AAR");
    const recUser = demoId("user:ST-04");
    const recMembership = (await c.query(`SELECT id FROM clinic_memberships WHERE "userId" = $1 AND "clinicId" = $2`, [recUser, clinicA])).rows[0].id as string;

    await c.query("BEGIN");
    try {
      await c.query(readFileSync(path.resolve(import.meta.dirname, "migrations", NAME, "migration.sql"), "utf8"));
      record(`${NAME} executes`, true);
      const fn = (await c.query(
        `SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND position('P5-PHONE-EDIT-1' IN p.prosrc) > 0 AS shape,
                has_function_privilege('sehat_app', p.oid, 'EXECUTE') AS app, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [FN])).rows[0];
      record("set_staff_phone: SECURITY DEFINER, search_path='', marker present", fn?.shape === true);
      record("EXECUTE: sehat_app only", fn?.app && !fn?.anon && !fn?.authd, JSON.stringify(fn ?? {}));

      const phone = async () => (await c.query(`SELECT phone FROM users WHERE id = $1`, [recUser])).rows[0].phone as string | null;
      const original = await phone();
      await pin(demoId("user:ST-02"), clinicA, demoId("branch:AAR-WKD"));
      const mgr = await attempt(`SELECT app.set_staff_phone($1, '+919800000051')`, [recMembership]);
      record("Clinic Manager refused (NOT_PERMITTED)", /staff phone: NOT_PERMITTED/.test(mgr));
      await pin(demoId("user:ST-07"), demoId("clinic:NIR"));
      const cross = await attempt(`SELECT app.set_staff_phone($1, '+919800000051')`, [recMembership]);
      record("other clinic's Administrator gets NOT_FOUND", /staff phone: NOT_FOUND/.test(cross));
      await pin(demoId("user:ST-01"), clinicA);
      const bad = await attempt(`SELECT app.set_staff_phone($1, '98000 00051')`, [recMembership]);
      record("malformed number refused (INVALID_PHONE, not echoed)", /staff phone: INVALID_PHONE/.test(bad) && !/98000/.test(bad));
      record("refusals changed nothing", (await phone()) === original);

      // occurredAt is the transaction's start time, so new events are found by id, not by time.
      const seen = (await c.query(`SELECT id FROM audit_events`)).rows.map((r) => r.id);
      const ok = await attempt(`SELECT app.set_staff_phone($1, '+919800000051')`, [recMembership]);
      record("Administrator sets the phone", ok === "OK" && (await phone()) === "+919800000051", ok === "OK" ? "" : ok);
      const events = (await c.query(`SELECT action, metadata::text AS m FROM audit_events WHERE NOT (id = ANY ($1))`, [seen])).rows;
      record("audited (staff.phone_updated + users.update naming the column)", events.some((e) => e.action === "staff.phone_updated") && events.some((e) => e.action === "users.update" && /"phone"/.test(e.m)), events.map((e) => e.action).join(","));
      record("no number in audit metadata", events.length > 0 && events.every((e) => !/98000/.test(e.m ?? "")), `${events.length} new events`);

      // Shared with another clinic → refused.
      await c.query(`INSERT INTO clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt")
                     VALUES (gen_random_uuid(), $1, $2, $3, (SELECT id FROM roles WHERE key = 'RECEPTIONIST'), 'INACTIVE', now())`, [recUser, demoId("clinic:NIR"), demoId("branch:NIR-IND")]);
      await pin(demoId("user:ST-01"), clinicA);
      const shared = await attempt(`SELECT app.set_staff_phone($1, '+919800000052')`, [recMembership]);
      record("person in another clinic: SHARED_ACCOUNT, unchanged", /staff phone: SHARED_ACCOUNT/.test(shared) && (await phone()) === "+919800000051");
    } finally {
      await c.query("ROLLBACK");
    }

    const after = await tableFingerprints(c, ["_prisma_migrations"]);
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: every table identical to before", drift.length === 0, drift.join(", ") || `${Object.keys(before).length} tables identical`);
    record("rolled back: function not present", (await c.query(`SELECT to_regprocedure($1) IS NULL AS gone`, [FN])).rows[0].gone === true);
    record("not recorded in _prisma_migrations", !(await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount);
  } finally {
    await c.end();
  }
  console.table(checks);
  const failed = checks.filter((x) => !x.ok);
  if (failed.length) {
    console.error(`${failed.length} dry-run check(s) FAILED. Nothing was committed.`);
    process.exit(1);
  }
  console.log(`All ${checks.length} dry-run checks passed. Nothing was committed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

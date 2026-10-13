// DRY RUN of 20261020000000_staff_invitation_phone — run only with explicit approval.
//
//   npm run db:p5-phone-dry-run
//
// Executes the migration inside ONE transaction on the admin connection
// (DIRECT_URL), exercises the new behaviour with fictional zztest addresses,
// and then ALWAYS rolls back: nothing is committed, nothing is recorded in
// _prisma_migrations, no email is sent. Afterwards every table is re-read to
// prove nothing changed. Phone numbers are never printed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { demoId } from "./seed/demo-data";
import { tableFingerprints } from "./p5-preflight";

config({ path: [".env.local", ".env"], quiet: true });

const NAME = "20261020000000_staff_invitation_phone";
const NEW_SIG = "app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean)";
const OLD_SIG = "app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean)";

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
      const rows = (await c.query(sql, params)).rows;
      await c.query("RELEASE SAVEPOINT dry");
      return { ok: true, rows, message: "" };
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT dry");
      return { ok: false, rows: [], message: (e as Error).message };
    }
  };
  try {
    if ((await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount) throw new Error(`${NAME} is already applied; nothing to dry-run.`);
    const before = await tableFingerprints(c, ["_prisma_migrations"]);

    await c.query("BEGIN");
    try {
      await c.query(readFileSync(path.resolve(import.meta.dirname, "migrations", NAME, "migration.sql"), "utf8"));
      record(`${NAME} executes`, true);

      const col = (await c.query(`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'phone'`)).rows[0];
      record("staff_invitations.phone added (nullable text)", col?.is_nullable === "YES" && col?.data_type === "text", JSON.stringify(col ?? {}));
      const existing = (await c.query(`SELECT count(*)::int AS n, count(phone)::int AS with_phone FROM staff_invitations`)).rows[0];
      record("existing invitations untouched (no phone backfilled)", existing.with_phone === 0, `${existing.n} rows`);
      const fn = (await c.query(
        `SELECT to_regprocedure($1) IS NULL AS old_gone, has_function_privilege('sehat_app', $2, 'EXECUTE') AS app,
                has_function_privilege('anon', $2, 'EXECUTE') AS anon, has_function_privilege('authenticated', $2, 'EXECUTE') AS authd,
                (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND position('P5-FIX-1' IN p.prosrc) > 0 AND position('P5-PHONE-1' IN p.prosrc) > 0
                   FROM pg_proc p WHERE p.oid = to_regprocedure($2)) AS shape,
                (SELECT count(*)::int FROM pg_proc WHERE proname = 'create_staff_invitation') AS overloads,
                has_function_privilege('sehat_app', 'app.accept_staff_invitation(uuid, text)', 'EXECUTE') AS accept_app,
                has_function_privilege('anon', 'app.accept_staff_invitation(uuid, text)', 'EXECUTE') AS accept_anon`,
        [OLD_SIG, NEW_SIG]
      )).rows[0];
      record("old create signature dropped; exactly one create function", fn.old_gone && fn.overloads === 1, `overloads=${fn.overloads}`);
      record("new create: SECURITY DEFINER, search_path='', P5-FIX-1 + P5-PHONE-1", fn.shape === true);
      record("EXECUTE: sehat_app only (create and accept)", fn.app && !fn.anon && !fn.authd && fn.accept_app && !fn.accept_anon, JSON.stringify(fn));

      // Behaviour, as the Aarogya administrator (SECURITY DEFINER: runs as its owner; grants checked above).
      const pinAdmin = () => c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.auth_user_id', '', true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', '', true)`, [demoId("user:ST-01"), demoId("clinic:AAR")]);
      await pinAdmin();
      const wakad = demoId("branch:AAR-WKD");
      const bad = await attempt(`SELECT app.create_staff_invitation('zztest.dry.bad@example.com', 'ZZ Dry', 'NURSE', $1, '98000 00001')`, [wakad]);
      record("invalid phone refused as INVALID_PHONE (number not in the message)", !bad.ok && /staff invitation: INVALID_PHONE/.test(bad.message) && !/98000/.test(bad.message), bad.message.replace(/\d{5,}/g, "<n>"));
      const missing = await attempt(`SELECT app.create_staff_invitation('zztest.dry.bad@example.com', 'ZZ Dry', 'NURSE', $1, NULL)`, [wakad]);
      record("missing phone refused", !missing.ok && /INVALID_PHONE/.test(missing.message));
      const a = await attempt(`SELECT app.create_staff_invitation('zztest.dry.a@example.com', 'ZZ Dry A', 'NURSE', $1, '+919800000011') AS id`, [wakad]);
      const b = await attempt(`SELECT app.create_staff_invitation('zztest.dry.b@example.com', 'ZZ Dry B', 'NURSE', $1, '+919800000012') AS id`, [wakad]);
      const stored = (await c.query(`SELECT count(*)::int AS n FROM staff_invitations WHERE email IN ('zztest.dry.a@example.com', 'zztest.dry.b@example.com') AND phone ~ '^\\+91980000001[12]$'`)).rows[0].n;
      record("valid invitations created with the phone stored (E.164)", a.ok && b.ok && stored === 2, a.message || b.message);
      const dup = await attempt(`SELECT app.create_staff_invitation('ZZTEST.DRY.A@example.com', 'ZZ Dry A', 'NURSE', $1, '+919800000011')`, [wakad]);
      record("duplicate still refused (ALREADY_INVITED)", !dup.ok && /ALREADY_INVITED/.test(dup.message));
      const doc = await attempt(
        `SELECT app.create_staff_invitation('zztest.dry.doc@example.com', 'ZZ Dry Doc', 'DOCTOR', $1, '+919800000013', $2, 'MBBS', 'ZZ-DRY-REG-1', 3, 50000, false) AS id`,
        [wakad, (await c.query(`SELECT id FROM specialties ORDER BY name LIMIT 1`)).rows[0].id]
      );
      record("doctor invitation with phone + details still works", doc.ok, doc.message);

      // Acceptance: copies the phone onto an account without one; never overwrites an existing phone.
      await c.query(`UPDATE users SET "authProviderId" = 'zz-dry-a', status = 'ACTIVE' WHERE email = 'zztest.dry.a@example.com'`);
      await c.query(`UPDATE users SET "authProviderId" = 'zz-dry-b', status = 'ACTIVE', phone = '+919800000099' WHERE email = 'zztest.dry.b@example.com'`);
      for (const [email, auth, inv] of [["zztest.dry.a@example.com", "zz-dry-a", a.rows[0]?.id], ["zztest.dry.b@example.com", "zz-dry-b", b.rows[0]?.id]]) {
        const uid = (await c.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;
        await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.auth_user_id', $2, true), set_config('app.clinic_id', '', true)`, [uid, auth]);
        const r = await attempt(`SELECT app.accept_staff_invitation($1, $2)`, [inv, email]);
        record(`accept works (${email.split("@")[0]})`, r.ok, r.message);
      }
      const phones = (await c.query(`SELECT email, phone = '+919800000011' AS got_invite_phone, phone = '+919800000099' AS kept_own FROM users WHERE email IN ('zztest.dry.a@example.com', 'zztest.dry.b@example.com') ORDER BY email`)).rows;
      record("accept copies the phone onto an account that had none", phones[0]?.got_invite_phone === true);
      record("accept never overwrites an existing phone", phones[1]?.kept_own === true);
      const leaks = (await c.query(`SELECT (SELECT count(*) FROM audit_events WHERE metadata::text LIKE '%98000000%')::int AS audit, (SELECT count(*) FROM notifications WHERE data::text LIKE '%98000000%')::int AS notes`)).rows[0];
      record("no phone in audit metadata or notification data", leaks.audit === 0 && leaks.notes === 0, JSON.stringify(leaks));
    } finally {
      await c.query("ROLLBACK");
    }

    const after = await tableFingerprints(c, ["_prisma_migrations"]);
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: every table identical to before", drift.length === 0, drift.join(", ") || `${Object.keys(before).length} tables identical`);
    const restored = (await c.query(`SELECT to_regprocedure($1) IS NOT NULL AS old_back, to_regprocedure($2) IS NULL AS new_gone,
        NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_invitations' AND column_name = 'phone') AS no_col`, [OLD_SIG, NEW_SIG])).rows[0];
    record("rolled back: original functions and columns in place", restored.old_back && restored.new_gone && restored.no_col);
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

// DRY RUN of 20261022000000_patient_link_codes.
//
//   npx tsx prisma/p64-dry-run.ts
//
// Executes the migration inside ONE transaction on the admin connection
// (DIRECT_URL), exercises the new functions as fixture users and as fake
// Supabase identities (pinned session settings, exactly as the app pins them),
// then ALWAYS rolls back: nothing is committed or recorded in
// _prisma_migrations, no account is created in Supabase Auth, and no email is
// sent. Every table is re-read afterwards to prove nothing changed. Codes are
// never printed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { demoId } from "./seed/demo-data";
import { tableFingerprints } from "./p5-preflight";

config({ path: [".env.local", ".env"], quiet: true });

const NAME = "20261022000000_patient_link_codes";
const ENTRY_POINTS = ["app.issue_patient_link_code(uuid, boolean)", "app.revoke_patient_link_code(uuid)", "app.patient_portal_link_status(uuid)", "app.redeem_patient_link_code(text, text)"];
const INTERNAL = ["app.new_patient_link_code()", "app.normalise_patient_link_code(text)", "app.patient_link_code_hash(text)", "app.require_patient_linker()"];

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const c = new Client(verifiedPgConfig(url));
  await c.connect();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  const attempt = async (sql: string, params: unknown[] = []): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; msg: string }> => {
    await c.query("SAVEPOINT dry");
    try {
      const res = await c.query(sql, params);
      await c.query("RELEASE SAVEPOINT dry");
      return { ok: true, rows: res.rows };
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT dry");
      return { ok: false, msg: (e as Error).message };
    }
  };
  const msg = (r: Awaited<ReturnType<typeof attempt>>) => (r.ok ? "OK" : r.msg);
  const pinStaff = (userKey: string, clinicKey: string, branchKey = "") =>
    c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true), set_config('app.auth_user_id', '', true)`,
      [demoId(`user:${userKey}`), demoId(`clinic:${clinicKey}`), branchKey ? demoId(`branch:${branchKey}`) : ""]);
  // As the redeem endpoint runs: only the Supabase identity is pinned.
  const pinAuth = (authId: string) =>
    c.query(`SELECT set_config('app.auth_user_id', $1, true), set_config('app.user_id', '', true), set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`, [authId]);
  const issue = async (patientId: string, confirmed = true) => attempt(`SELECT code, expires_at FROM app.issue_patient_link_code($1, $2)`, [patientId, confirmed]);
  const codeOf = (r: Awaited<ReturnType<typeof attempt>>) => (r.ok ? (r.rows[0].code as string) : "");
  const redeem = async (authId: string, code: string, email: string) => {
    await pinAuth(authId);
    const r = await attempt(`SELECT result, clinic_id FROM app.redeem_patient_link_code($1, $2)`, [code, email]);
    return r.ok ? (r.rows[0].result as string) : r.msg;
  };

  try {
    if ((await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount) throw new Error(`${NAME} is already applied; nothing to dry-run.`);
    const before = await tableFingerprints(c, ["_prisma_migrations"]);
    const clinicA = demoId("clinic:AAR");
    const unlinked = (await c.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NULL AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 6`, [clinicA])).rows.map((r) => r.id as string);
    const patientB = (await c.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NULL AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 1`, [demoId("clinic:NIR")])).rows[0]?.id as string;
    const linkedA = (await c.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NOT NULL LIMIT 1`, [clinicA])).rows[0]?.id as string | undefined;
    if (unlinked.length < 6 || !patientB) throw new Error("fixture patients not found (expected seed data)");
    const st04Email = (await c.query(`SELECT email FROM users WHERE id = $1`, [demoId("user:ST-04")])).rows[0]?.email as string;
    const receptionActive = Boolean((await c.query(`SELECT 1 FROM clinic_memberships WHERE "userId" = $1 AND status = 'ACTIVE'`, [demoId("user:ST-04")])).rowCount);
    const permsBefore = (await c.query(`SELECT key, name, module, description FROM permissions ORDER BY key`)).rows;

    await c.query("BEGIN");
    try {
      await c.query(readFileSync(path.resolve(import.meta.dirname, "migrations", NAME, "migration.sql"), "utf8"));
      record(`${NAME} executes`, true);

      // --- structure ---------------------------------------------------------------
      const t = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('patient_link_codes', 'patient_link_attempts') AND relnamespace = 'public'::regnamespace`)).rows;
      record("tables created with RLS enabled", t.length === 2 && t.every((r) => r.relrowsecurity), JSON.stringify(t));
      const grants = (await c.query(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
                                     WHERE table_schema = 'public' AND table_name IN ('patient_link_codes', 'patient_link_attempts') AND grantee IN ('sehat_app', 'anon', 'authenticated')`)).rows;
      record("no table privileges for sehat_app, anon or authenticated", grants.length === 0, JSON.stringify(grants));
      const fns = (await c.query(`SELECT f AS sig, p.prosecdef AS secdef, p.proconfig = ARRAY['search_path=""'] AS sp,
                                         has_function_privilege('sehat_app', p.oid, 'EXECUTE') AS app, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                                         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd
                                    FROM unnest($1::text[]) f JOIN pg_proc p ON p.oid = to_regprocedure(f)`, [[...ENTRY_POINTS, ...INTERNAL]])).rows;
      const by = (s: string) => fns.find((f) => f.sig === s);
      record("every function exists with search_path=''", fns.length === ENTRY_POINTS.length + INTERNAL.length && fns.every((f) => f.sp), `${fns.length} found`);
      record("entry points: SECURITY DEFINER, EXECUTE sehat_app only", ENTRY_POINTS.every((s) => by(s)?.secdef && by(s)?.app && !by(s)?.anon && !by(s)?.authd));
      record("internal helpers: not executable by sehat_app/anon/authenticated", INTERNAL.every((s) => by(s) && !by(s)?.app && !by(s)?.anon && !by(s)?.authd));

      const holders = (await c.query(`SELECT string_agg(r.key::text, ',' ORDER BY r.key::text) AS roles FROM role_permissions rp JOIN roles r ON r.id = rp."roleId"
                                       JOIN permissions p ON p.id = rp."permissionId" WHERE p.key = 'patient.portal_link'`)).rows[0].roles;
      record("patient.portal_link held by exactly ADMINISTRATOR, RECEPTIONIST", holders === "ADMINISTRATOR,RECEPTIONIST", holders);
      const permsAfter = (await c.query(`SELECT key, name, module, description FROM permissions WHERE key <> 'patient.portal_link' ORDER BY key`)).rows;
      record("existing permission rows unchanged", JSON.stringify(permsAfter) === JSON.stringify(permsBefore), `${permsBefore.length} rows`);

      // --- code generation ------------------------------------------------------------
      const gen = (await c.query(`SELECT app.new_patient_link_code() AS v FROM generate_series(1, 2000)`)).rows.map((r) => r.v as string);
      record("codes: 16 Crockford base32 characters, no repeats in 2000", gen.every((v) => /^[0-9A-HJKMNP-TV-Z]{16}$/.test(v)) && new Set(gen).size === gen.length);
      const counts = new Map<string, number>();
      for (const ch of gen.join("")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      const expected = (2000 * 16) / 32;
      record("codes: every symbol used, roughly uniform (±25%)", counts.size === 32 && [...counts.values()].every((n) => Math.abs(n - expected) < expected * 0.25), `${counts.size} symbols`);
      const norm = (await c.query(`SELECT app.normalise_patient_link_code(' abcd-efgh ijkm-nopq ') a, app.normalise_patient_link_code('ABCD') b, app.normalise_patient_link_code(repeat('A', 65)) c, app.normalise_patient_link_code('ABCD-EFGH-JKMN-PQRU') d`)).rows[0];
      record("normalise: case/space/dash ignored, O->0 I/L->1; short/long/U rejected", norm.a === "ABCDEFGH1JKMN0PQ" && norm.b === null && norm.c === null && norm.d === null, JSON.stringify(norm));

      // --- issue --------------------------------------------------------------------
      const seen = (await c.query(`SELECT id FROM audit_events`)).rows.map((r) => r.id);
      const [p1, p2, p3, p4, p5, p6] = unlinked;
      await pinStaff("ST-01", "AAR");
      const i1 = await issue(p1);
      const code1 = codeOf(i1);
      record("administrator issues a code (XXXX-XXXX-XXXX-XXXX, 72 h)", /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code1), msg(i1));
      const stored = (await c.query(`SELECT "codeHash", status::text, "expiresAt" - "createdAt" AS ttl FROM patient_link_codes WHERE "patientId" = $1`, [p1])).rows;
      record("only the SHA-256 hash is stored", stored.length === 1 && /^[0-9a-f]{64}$/.test(stored[0].codeHash) && !JSON.stringify(stored).includes(code1.replace(/-/g, "")), `${stored.length} row(s)`);
      record("identity confirmation is required", /patient link: IDENTITY_NOT_CONFIRMED/.test(msg(await issue(p2, false))));
      const st = await attempt(`SELECT linked, code_issued_at, code_expires_at FROM app.patient_portal_link_status($1)`, [p1]);
      record("status: not linked, active code with expiry (no code returned)", st.ok && st.rows[0].linked === false && st.rows[0].code_expires_at !== null && !("code" in st.rows[0]), msg(st));
      const i1b = await issue(p1);
      record("re-issue supersedes the previous code", i1b.ok && (await c.query(`SELECT count(*)::int n FROM patient_link_codes WHERE "patientId" = $1 AND status = 'ACTIVE'`, [p1])).rows[0].n === 1);
      const code1b = codeOf(i1b);
      if (linkedA) record("already-linked patient: ALREADY_LINKED", /patient link: ALREADY_LINKED/.test(msg(await issue(linkedA))));
      record("other clinic's patient: NOT_FOUND", /patient link: NOT_FOUND/.test(msg(await issue(patientB))));
      if (receptionActive) {
        await pinStaff("ST-04", "AAR", "AAR-WKD");
        record("receptionist issues a code", (await issue(p2)).ok);
      } else record("receptionist check SKIPPED: fixture ST-04 inactive (not a failure)", true);
      for (const [who, branch] of [["ST-02", "AAR-WKD"], ["ST-05", "AAR-KTH"], ["DR-01", ""]] as const) {
        await pinStaff(who, "AAR", branch);
        record(`${who}: NOT_PERMITTED (issue, revoke, status)`,
          /patient link: NOT_PERMITTED/.test(msg(await issue(p3))) && /patient link: NOT_PERMITTED/.test(msg(await attempt(`SELECT app.revoke_patient_link_code($1)`, [p3]))) &&
          /patient link: NOT_PERMITTED/.test(msg(await attempt(`SELECT * FROM app.patient_portal_link_status($1)`, [p3]))));
      }
      await pinAuth("zz-auth-nobody");
      record("no staff context: NOT_PERMITTED", /patient link: NOT_PERMITTED/.test(msg(await issue(p3))));

      // --- redeem --------------------------------------------------------------------
      const newEmail = "zztest.p64.new@example.com";
      record("old (superseded) code: INVALID", (await redeem("zz-auth-new", code1, newEmail)) === "INVALID");
      record("malformed code: INVALID", (await redeem("zz-auth-new", "hello", newEmail)) === "INVALID");
      record("no verified email: refused", /patient link: EMAIL_NOT_VERIFIED/.test(await redeem("zz-auth-new", code1b, "")));
      await c.query(`SELECT set_config('app.auth_user_id', '', true)`);
      record("no auth identity: NOT_PERMITTED", /patient link: NOT_PERMITTED/.test(msg(await attempt(`SELECT * FROM app.redeem_patient_link_code($1, $2)`, [code1b, newEmail]))));
      const linked = await redeem("zz-auth-new", code1b.toLowerCase().replace(/-/g, " "), newEmail.toUpperCase());
      const acct = (await c.query(`SELECT u.id, u.status::text, u.email FROM users u WHERE u."authProviderId" = 'zz-auth-new'`)).rows[0];
      const link = acct && (await c.query(`SELECT p.id FROM patients p WHERE p."userId" = $1`, [acct.id])).rows;
      const mem = acct && (await c.query(`SELECT m.status::text, m."branchId", r.key::text AS role FROM clinic_memberships m JOIN roles r ON r.id = m."roleId" WHERE m."userId" = $1`, [acct.id])).rows;
      record("valid code: LINKED; account ACTIVE with the verified email", linked === "LINKED" && acct?.status === "ACTIVE" && acct?.email === newEmail, linked);
      record("exactly the code's patient linked; one ACTIVE clinic-wide PATIENT membership",
        link?.length === 1 && link[0].id === p1 && mem?.length === 1 && mem[0].role === "PATIENT" && mem[0].status === "ACTIVE" && mem[0].branchId === null);
      record("code is now REDEEMED by that account", (await c.query(`SELECT status::text s, "redeemedByUserId" r FROM patient_link_codes WHERE "codeHash" = app.patient_link_code_hash(app.normalise_patient_link_code($1))`, [code1b])).rows[0]?.s === "REDEEMED");
      await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true)`, [acct?.id ?? "", clinicA]);
      const ids = (await c.query(`SELECT app.current_patient_ids() AS ids`)).rows[0].ids as string[];
      record("app.current_patient_ids() for the new account = [that patient]", ids.length === 1 && ids[0] === p1, JSON.stringify(ids));
      record("replay by the same account: ALREADY_LINKED (idempotent)", (await redeem("zz-auth-new", code1b, newEmail)) === "ALREADY_LINKED");
      record("replay by another account: INVALID", (await redeem("zz-auth-other", code1b, "zztest.p64.other@example.com")) === "INVALID");
      await pinStaff("ST-01", "AAR");
      record("staff status shows linked", (await attempt(`SELECT linked FROM app.patient_portal_link_status($1)`, [p1])).ok &&
        (await c.query(`SELECT linked FROM app.patient_portal_link_status($1)`, [p1])).rows[0].linked === true);
      record("linked patient: new code refused (ALREADY_LINKED)", /patient link: ALREADY_LINKED/.test(msg(await issue(p1))));

      // An account that already has a patient can't take a second one.
      const code3 = codeOf(await issue(p3));
      record("account already linked to a patient: NOT_ELIGIBLE (code stays usable)",
        (await redeem("zz-auth-new", code3, newEmail)) === "NOT_ELIGIBLE" &&
        (await c.query(`SELECT status::text s FROM patient_link_codes WHERE "patientId" = $1 AND status = 'ACTIVE'`, [p3])).rowCount === 1);

      // Staff of the same clinic (INVITED fixture, linked by its email) can't become a patient there.
      if (st04Email) record("staff member of that clinic: NOT_ELIGIBLE", (await redeem("zz-auth-st04", code3, st04Email)) === "NOT_ELIGIBLE");
      // Disabled account.
      await c.query(`INSERT INTO users (id, email, name, status, "authProviderId", "updatedAt") VALUES (gen_random_uuid(), 'zztest.p64.disabled@example.com', 'ZZTEST', 'DISABLED', 'zz-auth-disabled', now())`);
      record("disabled account: NOT_ELIGIBLE", (await redeem("zz-auth-disabled", code3, "zztest.p64.disabled@example.com")) === "NOT_ELIGIBLE");
      // Email owned by a different login.
      record("email belonging to another login: NOT_ELIGIBLE", (await redeem("zz-auth-thief", code3, newEmail)) === "NOT_ELIGIBLE");

      // Expired and revoked.
      await pinStaff("ST-01", "AAR");
      const code4 = codeOf(await issue(p4));
      await c.query(`UPDATE patient_link_codes SET "createdAt" = now() - interval '4 days', "expiresAt" = now() - interval '1 day' WHERE "patientId" = $1 AND status = 'ACTIVE'`, [p4]);
      record("expired code: INVALID", (await redeem("zz-auth-exp", code4, "zztest.p64.exp@example.com")) === "INVALID");
      await pinStaff("ST-01", "AAR");
      const code5 = codeOf(await issue(p5));
      const rv = await attempt(`SELECT app.revoke_patient_link_code($1) AS r`, [p5]);
      record("revoke returns true", rv.ok && rv.rows[0].r === true, msg(rv));
      record("revoked code: INVALID", (await redeem("zz-auth-rev", code5, "zztest.p64.rev@example.com")) === "INVALID");

      // Cross-clinic: clinic B admin can't revoke/see clinic A's patient.
      await pinStaff("ST-07", "NIR");
      record("other clinic's administrator: revoke/status NOT_FOUND",
        /patient link: NOT_FOUND/.test(msg(await attempt(`SELECT app.revoke_patient_link_code($1)`, [p1]))) &&
        /patient link: NOT_FOUND/.test(msg(await attempt(`SELECT * FROM app.patient_portal_link_status($1)`, [p1]))));

      // Rate limit: 5 failures in 15 minutes, then even a valid code is refused.
      await pinStaff("ST-01", "AAR");
      const code6 = codeOf(await issue(p6));
      const brute = "zz-auth-brute";
      const fails: string[] = [];
      for (let i = 0; i < 5; i++) fails.push(await redeem(brute, `ZZZZ-ZZZZ-ZZZZ-ZZZ${i}`, "zztest.p64.brute@example.com"));
      record("5 wrong codes: INVALID each", fails.every((f) => f === "INVALID"), fails.join(","));
      record("6th attempt (even a valid code): RATE_LIMITED", (await redeem(brute, code6, "zztest.p64.brute@example.com")) === "RATE_LIMITED");
      record("limit is per account: another account still redeems", (await redeem("zz-auth-ok", code6, "zztest.p64.ok@example.com")) === "LINKED");
      const att = (await c.query(`SELECT count(*)::int n FROM patient_link_attempts WHERE "authUserId" = $1`, [brute])).rows[0].n;
      record("rate-limited attempt is not recorded (only the 5 failures)", att === 5, String(att));

      // --- audit --------------------------------------------------------------------------
      const events = (await c.query(`SELECT action, outcome::text, reason, metadata::text AS m, "clinicId" FROM audit_events WHERE NOT (id = ANY ($1))`, [seen])).rows;
      const actions = new Set(events.map((e) => e.action));
      record("events: issued, revoked, linked, redeem_failed", ["patient.link_code_issued", "patient.link_code_revoked", "patient.portal_linked", "patient.link_code_redeem_failed"].every((a) => actions.has(a)), [...actions].sort().join(","));
      const allCodes = [code1, code1b, code3, code4, code5, code6].map((x) => x.replace(/-/g, ""));
      const hashes = (await c.query(`SELECT "codeHash" FROM patient_link_codes`)).rows.map((r) => r.codeHash as string);
      record("no code or code hash in any audit event", events.every((e) => !allCodes.some((x) => `${e.m}${e.reason}`.toUpperCase().includes(x)) && !hashes.some((h) => `${e.m}`.includes(h))), `${events.length} new events`);
      record("unknown-code failures are not attributed to any clinic", events.filter((e) => e.action === "patient.link_code_redeem_failed" && ["unknown", "malformed"].includes(e.reason)).every((e) => e.clinicId === null));
    } finally {
      await c.query("ROLLBACK");
    }

    const after = await tableFingerprints(c, ["_prisma_migrations"]);
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: every table identical to before", drift.length === 0, drift.join(", ") || `${Object.keys(before).length} tables identical`);
    record("rolled back: new tables and functions not present", (await c.query(`SELECT to_regclass('public.patient_link_codes') IS NULL AND to_regprocedure('app.redeem_patient_link_code(text, text)') IS NULL AS gone`)).rows[0].gone === true);
    record("not recorded in _prisma_migrations", !(await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount);
  } finally {
    await c.end();
  }
  console.table(checks.map(({ check, ok, detail }) => ({ check, ok, detail: detail.slice(0, 80) })));
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

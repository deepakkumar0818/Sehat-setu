// P5 migration DRY RUN — run only with explicit approval.
//
//   npx tsx prisma/p5-dry-run.ts
//
// Executes both P5 migration files inside ONE transaction on the admin
// connection (DIRECT_URL), checks the result, and then ALWAYS rolls back.
// It never records anything in _prisma_migrations and never commits.
// Afterwards it re-reads every existing table to prove nothing changed.
//
// A successful dry run shows the SQL applies cleanly to this database's
// current state; it is NOT proof that a later real apply succeeded — after
// `npm run db:migrate`, run prisma/p5-preflight.ts and npm run db:verify-rls.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { P5_MIGRATIONS, tableFingerprints } from "./p5-preflight";

config({ path: [".env.local", ".env"], quiet: true });

const NEW_TABLES = ["notifications", "notification_reads", "staff_invitations", "staff_invitation_doctor_details"];
const ENTRY_FUNCTIONS = [
  "app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean)",
  "app.resend_staff_invitation(uuid)",
  "app.record_invitation_delivery(uuid, boolean, text)",
  "app.revoke_staff_invitation(uuid)",
  "app.my_staff_invitations(text)",
  "app.accept_staff_invitation(uuid, text)",
];
const INTERNAL_FUNCTIONS = ["app.add_notification(uuid, text, uuid, uuid, text[], text, uuid, jsonb)", "app.require_inviter()", "app.mask_email(text)", "app.notify_appointment_change()", "app.notify_stock_level()"];

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const client = new Client(verifiedPgConfig(url));
  await client.connect();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  try {
    const applied = (await client.query(`SELECT migration_name FROM _prisma_migrations WHERE migration_name = ANY($1)`, [P5_MIGRATIONS])).rows;
    if (applied.length) throw new Error(`P5 migrations are already applied (${applied.map((r) => r.migration_name).join(", ")}); nothing to dry-run.`);

    const before = await tableFingerprints(client, ["_prisma_migrations"]);
    await client.query("BEGIN");
    try {
      for (const name of P5_MIGRATIONS) {
        const sql = readFileSync(path.resolve(import.meta.dirname, "migrations", name, "migration.sql"), "utf8");
        await client.query(sql); // simple-query protocol: the whole file, as prisma migrate deploy would
        record(`${name} executes`, true);
      }

      const present = (await client.query(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1)`, [NEW_TABLES])).rows;
      record("4 new tables exist with RLS enabled", present.length === 4 && present.every((r) => r.relrowsecurity), present.map((r) => `${r.relname}:${r.relrowsecurity}`).join(" "));

      const grants = (await client.query(`SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'sehat_app' AND table_name = ANY($1) ORDER BY 1, 2`, [NEW_TABLES])).rows;
      const tableGrants = grants.map((g) => `${g.table_name}:${g.privilege_type}`).join(",");
      record("runtime role has only SELECT on the new tables", grants.every((g) => g.privilege_type === "SELECT") && grants.length === 4, tableGrants);
      const colGrants = (await client.query(`SELECT column_name FROM information_schema.column_privileges WHERE grantee = 'sehat_app' AND table_name = 'notification_reads' AND privilege_type = 'INSERT' ORDER BY 1`)).rows.map((r) => r.column_name);
      record("runtime role may INSERT only (userId, notificationId) into notification_reads", colGrants.join(",") === "notificationId,userId", colGrants.join(","));

      for (const fn of ENTRY_FUNCTIONS) {
        const r = (await client.query(`SELECT has_function_privilege('sehat_app', $1, 'EXECUTE') AS app, has_function_privilege('anon', $1, 'EXECUTE') AS anon`, [fn])).rows[0];
        record(`sehat_app may execute ${fn.split("(")[0]} (anon may not)`, r.app === true && r.anon === false);
      }
      for (const fn of INTERNAL_FUNCTIONS) {
        const r = (await client.query(`SELECT has_function_privilege('sehat_app', $1, 'EXECUTE') AS app`, [fn])).rows[0];
        record(`sehat_app may NOT execute ${fn.split("(")[0]}`, r.app === false);
      }
      const idx = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('users_email_lower_key', 'staff_invitations_one_pending')`)).rows.map((r) => r.indexname).sort();
      record("unique indexes created (users lower(email), one pending invitation)", idx.length === 2, idx.join(","));
      const triggers = (await client.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('notify_appointments','notify_stock_level','audit_staff_invitations','audit_staff_invitation_doctor_details') AND NOT tgisinternal`)).rows.length;
      record("4 triggers created", triggers === 4, `${triggers}`);

      const inside = await tableFingerprints(client, ["_prisma_migrations", ...NEW_TABLES]);
      const changed = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(inside[t]));
      record("no existing row changed while applying (counts + checksums)", changed.length === 0, changed.join(", ") || `${Object.keys(before).length} tables identical`);
    } finally {
      await client.query("ROLLBACK");
    }

    const after = await tableFingerprints(client, ["_prisma_migrations"]);
    const leftovers = Object.keys(after).filter((t) => NEW_TABLES.includes(t));
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: no P5 table remains", leftovers.length === 0, leftovers.join(", "));
    record("rolled back: every existing table identical to before", drift.length === 0, drift.join(", ") || "identical");
  } finally {
    await client.end();
  }
  console.table(checks);
  const failed = checks.filter((c) => !c.ok);
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

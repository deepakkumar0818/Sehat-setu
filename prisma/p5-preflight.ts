// P5 migration preflight. READ-ONLY: everything runs in one READ ONLY
// transaction on the admin connection (DIRECT_URL); nothing can be written.
//
//   npx tsx prisma/p5-preflight.ts
//
// Reports: migration state, case-insensitive email conflicts (the new unique
// index would fail on them), name collisions with the P5 objects, the role and
// grant state the migrations rely on, and row counts + checksums of every
// existing table (compare them after applying to prove no existing row changed).
// Never prints connection strings, emails or other personal data.
import { createHash } from "node:crypto";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

export const P5_MIGRATIONS = ["20261019000000_notifications", "20261019000100_staff_invitations"] as const;

/** Row count + an order-independent checksum of every row's full contents, per public table. */
export async function tableFingerprints(client: Client, exclude: string[] = []): Promise<Record<string, { rows: number; checksum: string }>> {
  const tables = (
    await client.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)
  ).rows.map((r) => r.t).filter((t) => !exclude.includes(t));
  const out: Record<string, { rows: number; checksum: string }> = {};
  for (const t of tables) {
    // md5 of each row's text form, aggregated in a fixed order: any changed, added or removed row changes it.
    const r = await client.query<{ n: string; h: string | null }>(
      `SELECT count(*)::text AS n, md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))) AS h FROM public.${JSON.stringify(t)} x`
    );
    out[t] = { rows: Number(r.rows[0].n), checksum: r.rows[0].h ?? "empty" };
  }
  return out;
}

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const client = new Client(verifiedPgConfig(url));
  await client.connect();
  const problems: string[] = [];
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const applied = (await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`
    )).rows;
    const unfinished = applied.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name);
    if (unfinished.length) problems.push(`unfinished migrations: ${unfinished.join(", ")}`);
    const already = applied.filter((m) => (P5_MIGRATIONS as readonly string[]).includes(m.migration_name)).map((m) => m.migration_name);
    console.log(`Latest applied migration: ${applied.filter((m) => m.finished_at).at(-1)?.migration_name ?? "(none)"}`);
    console.log(`P5 migrations already applied: ${already.length ? already.join(", ") : "none"}`);

    const dupes = Number((await client.query(`SELECT count(*) AS n FROM (SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1) d`)).rows[0].n);
    console.log(`Case-insensitive duplicate emails in users: ${dupes}`);
    if (dupes > 0) problems.push(`${dupes} email(s) differ only by case — users_email_lower_key would fail (resolve manually; never automatically)`);
    const unnormalised = Number((await client.query(`SELECT count(*) AS n FROM users WHERE email <> lower(btrim(email))`)).rows[0].n);
    console.log(`User emails not stored lower-case/trimmed: ${unnormalised} (informational; matching is case-insensitive)`);

    if (!already.length) {
      const clashes = (await client.query<{ name: string }>(`
        SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname IN ('notifications','notification_reads','staff_invitations','staff_invitation_doctor_details','users_email_lower_key','staff_invitations_one_pending')
        UNION ALL SELECT typname FROM pg_type WHERE typname IN ('NotificationScope','NotificationType','InvitationStatus','InvitationDelivery')
        UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.proname IN ('add_notification','notify_appointment_change','notify_stock_level','mask_email','require_inviter',
           'create_staff_invitation','resend_staff_invitation','record_invitation_delivery','revoke_staff_invitation','my_staff_invitations','accept_staff_invitation')`)).rows;
      console.log(`Name collisions with P5 objects: ${clashes.length ? clashes.map((c) => c.name).join(", ") : "none"}`);
      if (clashes.length) problems.push(`objects already exist: ${clashes.map((c) => c.name).join(", ")}`);
    }

    const role = (await client.query(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'sehat_app'`)).rows[0];
    console.log(`Runtime role sehat_app: ${role ? `present, BYPASSRLS=${role.rolbypassrls}, SUPERUSER=${role.rolsuper}` : "MISSING"}`);
    if (!role || role.rolbypassrls || role.rolsuper) problems.push("sehat_app missing or over-privileged");
    const helpers = (await client.query<{ proname: string }>(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname IN ('is_staff_member','staff_can','branch_visible','log_event','audit_row_change','current_user_id','current_clinic_id','current_auth_user_id')`)).rows.map((r) => r.proname);
    console.log(`Required app.* helpers present: ${helpers.length}/8`);
    if (helpers.length < 8) problems.push("required app.* helper functions are missing");
    const specialties = Number((await client.query(`SELECT count(*) AS n FROM specialties`)).rows[0].n);
    console.log(`Specialties available for doctor invitations: ${specialties}`);

    const fp = await tableFingerprints(client, ["_prisma_migrations"]);
    console.log("\nExisting tables (row count, checksum) — compare after applying:");
    console.table(Object.fromEntries(Object.entries(fp).map(([t, v]) => [t, { rows: v.rows, checksum: v.checksum.slice(0, 12) }])));
    const overall = createHash("sha256").update(JSON.stringify(fp)).digest("hex").slice(0, 16);
    console.log(`Combined fingerprint: ${overall}`);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
  if (problems.length) {
    console.error(`\nPREFLIGHT FAILED:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\nPreflight passed. (Backup/PITR status can't be read from the database — confirm it in the Supabase dashboard.)");
}

if (process.argv[1] && /p5-preflight\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

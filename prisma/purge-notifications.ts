// Operator-only notification retention cleanup (90 days).
//
//   npm run db:purge-notifications            # dry run: counts only, deletes nothing
//   npm run db:purge-notifications -- --apply # deletes notifications older than 90 days
//
// Runs on the admin connection (DIRECT_URL); the app's runtime role has no
// DELETE privilege on notifications. Read receipts of deleted notifications go
// with them (ON DELETE CASCADE). Nothing else is touched, nothing is scheduled,
// and only counts are printed. The app already hides notifications older than
// 90 days, so running this late (or never) changes nothing users can see.
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

export const RETENTION_DAYS = 90;
const BATCH = 1000;

export function parsePurgeArgs(argv: string[]): { apply: boolean } {
  const unknown = argv.filter((a) => a !== "--apply" && a !== "--dry-run");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}. Use --apply to delete; the default is a dry run.`);
  return { apply: argv.includes("--apply") && !argv.includes("--dry-run") };
}

async function main() {
  const { apply } = parsePurgeArgs(process.argv.slice(2));
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const client = new Client(verifiedPgConfig(url));
  await client.connect();
  try {
    const exists = (await client.query(`SELECT to_regclass('public.notifications') IS NOT NULL AS ok`)).rows[0].ok;
    if (!exists) {
      console.log("The notifications table doesn't exist (migration 20261019000000_notifications not applied). Nothing to do.");
      return;
    }
    const due = Number((await client.query(`SELECT count(*) AS n FROM notifications WHERE "createdAt" < now() - make_interval(days => $1)`, [RETENTION_DAYS])).rows[0].n);
    const total = Number((await client.query(`SELECT count(*) AS n FROM notifications`)).rows[0].n);
    console.log(`Notifications: ${total} total, ${due} older than ${RETENTION_DAYS} days.`);
    if (!apply) {
      console.log("Dry run — nothing deleted. Re-run with --apply to delete them.");
      return;
    }
    let deleted = 0;
    for (;;) {
      // Each batch is its own short transaction; the cutoff is re-evaluated so nothing newer is touched.
      const r = await client.query(
        `DELETE FROM notifications WHERE id IN (
           SELECT id FROM notifications WHERE "createdAt" < now() - make_interval(days => $1) ORDER BY "createdAt" LIMIT $2)`,
        [RETENTION_DAYS, BATCH]
      );
      deleted += r.rowCount ?? 0;
      if ((r.rowCount ?? 0) < BATCH) break;
    }
    console.log(`Deleted ${deleted} notification(s) older than ${RETENTION_DAYS} days (and their read receipts).`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /purge-notifications\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

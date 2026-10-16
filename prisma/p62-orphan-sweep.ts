// P6.2 storage orphan sweep (operator tool).
//
//   npx tsx prisma/p62-orphan-sweep.ts           # DRY RUN: list what would be removed (default)
//   npx tsx prisma/p62-orphan-sweep.ts --apply   # remove those objects
//
// Lists objects in the private "patient-documents" bucket that no usable
// document points to:
//   * objects with no patient_documents row at all ("no_row") — REPORTED ONLY,
//     never removed: after a database restore they can be the only copy of a
//     file whose row was lost. An operator reviews them by hand (see "Backup
//     and recovery runbook" in docs/security.md);
//   * objects of FAILED rows,
//   * objects of rows still UPLOADING more than 2 hours after registration
//     (app.complete_patient_document_upload refuses after 1 hour).
// --apply removes only the last two kinds, and only while the restore hold is
// explicitly OFF (fail closed; see RESTORE_HOLD_SETTING below). Objects of
// AVAILABLE or ARCHIVED rows are never touched, and the hold and every
// candidate are re-checked immediately before each removal. Database rows are
// never changed or deleted (FAILED rows stay for the audit trail). Prints
// object keys (clinic/document ids) only — no names, titles or file contents —
// and never prints keys or credentials.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Client } from "pg";
import { verifiedPgConfig } from "../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

const BUCKET = "patient-documents";
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

type Candidate = { key: string; why: "no_row" | "failed" | "stale_uploading" };

// Restore hold: a DATABASE-WIDE setting, so every operator connecting to this
// database sees the same state, and a database restored into a new project
// starts without it — i.e. held. Set by the owner (see docs/security.md):
//   ALTER DATABASE postgres SET sehat.restore_hold = 'on';   -- hold (no removals)
//   ALTER DATABASE postgres SET sehat.restore_hold = 'off';  -- clear
// Anything other than exactly 'off' — missing, unreadable, another value, or
// a role/session override that disagrees — counts as an ACTIVE hold.
export const RESTORE_HOLD_SETTING = "sehat.restore_hold";
export type RestoreHold = { active: boolean; reason: string };

/** dbWideConfig: pg_db_role_setting.setconfig for this database (all roles); effective: current_setting() in this session. */
export function evaluateRestoreHold(dbWideConfig: string[] | null | undefined, effective: string | null | undefined): RestoreHold {
  const prefix = `${RESTORE_HOLD_SETTING}=`;
  const values = (dbWideConfig ?? []).filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
  if (values.length === 0) return { active: true, reason: "not configured — treated as active (fail closed)" };
  if (values.length > 1) return { active: true, reason: "ambiguous — treated as active (fail closed)" };
  if (values[0] === "on") return { active: true, reason: "on" };
  if (values[0] !== "off") return { active: true, reason: "unrecognised value — treated as active (fail closed)" };
  if (effective !== "off") return { active: true, reason: "overridden for this role or session — treated as active (fail closed)" };
  return { active: false, reason: "off" };
}

/** Reads the hold from the catalog (live, not cached per session). Any error means an active hold. */
export async function readRestoreHold(db: Pick<Client, "query">): Promise<RestoreHold> {
  try {
    const r = await db.query<{ setconfig: string[] | null; effective: string | null }>(
      `SELECT (SELECT setconfig FROM pg_db_role_setting
                WHERE setrole = 0 AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())) AS setconfig,
              current_setting('${RESTORE_HOLD_SETTING}', true) AS effective`
    );
    if (r.rows.length !== 1) return { active: true, reason: "unreadable — treated as active (fail closed)" };
    return evaluateRestoreHold(r.rows[0].setconfig, r.rows[0].effective);
  } catch {
    return { active: true, reason: "unreadable — treated as active (fail closed)" };
  }
}

/** The candidates --apply may remove: never "no_row" objects (manual review only). */
export function removable(list: Candidate[]): Candidate[] {
  return list.filter((c) => c.why === "failed" || c.why === "stale_uploading");
}

async function candidates(db: Client): Promise<{ list: Candidate[]; kept: number; total: number }> {
  const objects = (await db.query<{ name: string }>(`SELECT name FROM storage.objects WHERE bucket_id = $1 AND created_at < now() - interval '1 hour'`, [BUCKET])).rows;
  const rows = new Map(
    (await db.query<{ k: string; status: string; stale: boolean }>(
      `SELECT "storageKey" AS k, status::text, "createdAt" < now() - interval '2 hours' AS stale FROM patient_documents`
    )).rows.map((r) => [r.k, r])
  );
  const list: Candidate[] = [];
  let kept = 0;
  for (const { name } of objects) {
    const row = rows.get(name);
    if (!row) list.push({ key: name, why: "no_row" });
    else if (row.status === "FAILED") list.push({ key: name, why: "failed" });
    else if (row.status === "UPLOADING" && row.stale) list.push({ key: name, why: "stale_uploading" });
    else kept++;
  }
  return { list, kept, total: objects.length };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new Client(verifiedPgConfig(process.env.DIRECT_URL!));
  await db.connect();
  try {
    await db.query("BEGIN TRANSACTION READ ONLY");
    const { list, kept, total } = await candidates(db);
    await db.query("ROLLBACK");
    const hold = await readRestoreHold(db);
    const toRemove = removable(list);
    console.log(`Restore hold: ${hold.active ? "ACTIVE" : "clear"} (${hold.reason}).`);
    console.log(`${total} object(s) older than 1 hour; ${kept} belong to usable documents and are kept; ${list.length} orphan(s).`);
    for (const c of list) console.log(`  ${c.why.padEnd(16)} ${c.key}${c.why === "no_row" ? "  (manual review — never removed automatically)" : ""}`);
    if (!apply || toRemove.length === 0) {
      if (!apply && toRemove.length) console.log("Dry run: nothing removed. Re-run with --apply to remove the FAILED / stale UPLOADING objects (only while the restore hold is off).");
      return;
    }
    if (hold.active) throw new Error(`Restore hold is active (${hold.reason}): nothing removed. See "Backup and recovery runbook" in docs/security.md.`);
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!secret || secret.startsWith("sb_publishable_")) throw new Error("SUPABASE_SECRET_KEY is missing or is not a secret key (value not shown).");
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(BUCKET);
    let removed = 0;
    for (const c of toRemove) {
      if (!KEY.test(c.key)) continue;
      // Re-check the hold right before each removal: it may have been set while this ran.
      const now = await readRestoreHold(db);
      if (now.active) {
        console.error(`Restore hold became active (${now.reason}): stopping.`);
        break;
      }
      // Re-check right before removing: never an object whose row is (now) AVAILABLE or ARCHIVED, or that lost its row.
      const row = (await db.query<{ status: string }>(`SELECT status::text FROM patient_documents WHERE "storageKey" = $1`, [c.key])).rows[0];
      if (!row || row.status === "AVAILABLE" || row.status === "ARCHIVED") continue;
      const { error } = await storage.remove([c.key]);
      if (error) console.error(`  could not remove ${c.key}`);
      else removed++;
    }
    console.log(`Removed ${removed} orphan object(s).`);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && /p62-orphan-sweep\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

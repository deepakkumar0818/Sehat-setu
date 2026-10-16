// Storage consistency check (operator tool, READ ONLY).
//
//   npm run db:storage-consistency                                   # rows vs objects, sizes, types, keys, bucket posture
//   npm run db:storage-consistency -- --verify-checksums             # also re-hash stored files (at most 200)
//   npm run db:storage-consistency -- --verify-checksums --max-files=1000
//
// Compares patient_documents rows with the objects in the private
// "patient-documents" bucket. A database backup does NOT include Storage
// objects, so after any restore both sides must be checked together (see
// "Backup and recovery runbook" in docs/security.md).
//
// Read-only by design: one REPEATABLE READ, READ ONLY transaction on
// DIRECT_URL reads both tables from the same snapshot (storage.objects lives in
// the same database), page by page in storage-key order. --verify-checksums
// downloads each file into memory with the server secret key, hashes it and
// discards it; nothing is written to disk, and nothing is uploaded, moved,
// archived or deleted. To check a restored project, export that project's
// DIRECT_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in the shell
// first (they take precedence over .env.local).
//
// Output: counts per finding, plus up to 20 DOCUMENT IDS per finding (never
// clinic ids, raw storage keys, names, titles, filenames, checksums or file
// contents). Errors print their class and code only.
//
// Exit code: 0 consistent (warnings allowed), 1 mismatch found, 2 could not verify.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Client } from "pg";
import { verifiedPgConfig } from "../src/server/db/tls";
import { errorSummary } from "../src/server/log";

config({ path: [".env.local", ".env"], quiet: true });

export const BUCKET = "patient-documents";
export const PAGE_SIZE = 500;
export const SAMPLE_LIMIT = 20;
const DEFAULT_MAX_FILES = 200;
// The approved bucket settings (prisma/p62-storage-setup.ts).
const EXPECTED = { fileSizeLimit: 8 * 1024 * 1024, mimeTypes: ["application/pdf", "image/jpeg", "image/png"] };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = new RegExp(`^(${UUID})/(${UUID})$`);

export type DocRow = { id: string; clinicId: string; storageKey: string; status: string; sizeBytes: number; mimeType: string; sha256: string; stale: boolean };
export type StoredObject = { name: string; size: number | null; mimetype: string | null };
export type BucketPosture = { exists: boolean; public: boolean | null; fileSizeLimit: number | null; mimeTypes: string[] | null; rls: boolean | null; policies: number };

/** Read access to one consistent snapshot. Pages are ordered by key, byte-wise (COLLATE "C"), after the given key. */
export interface ConsistencySource {
  bucket(): Promise<BucketPosture>;
  rows(after: string | null, limit: number): Promise<DocRow[]>;
  objects(after: string | null, limit: number): Promise<StoredObject[]>;
}

export type Finding =
  // failures (exit 1)
  | "bucket_missing" | "bucket_public" | "storage_rls_disabled" | "storage_policies_present"
  | "missing_object" | "unreferenced_object" | "malformed_object_key" | "key_ownership"
  | "size_mismatch" | "size_unknown" | "type_mismatch" | "checksum_mismatch" | "unreadable_object"
  // warnings (reported, exit 0)
  | "bucket_settings_differ" | "failed_row_object" | "stale_upload_object" | "checksums_not_verified";

export const FAILURES: ReadonlySet<Finding> = new Set<Finding>([
  "bucket_missing", "bucket_public", "storage_rls_disabled", "storage_policies_present",
  "missing_object", "unreferenced_object", "malformed_object_key", "key_ownership",
  "size_mismatch", "size_unknown", "type_mismatch", "checksum_mismatch", "unreadable_object",
]);

export type Report = {
  rows: number;
  objects: number;
  matched: number;
  usableRows: number;
  inProgressUploads: number;
  checksumsVerified: number;
  findings: Partial<Record<Finding, { count: number; samples: string[] }>>;
};

export type ChecksumTarget = { id: string; key: string; sha256: string; sizeBytes: number };

/** Sanitised identifier: the document id only (the second key segment), never the clinic id or the raw key. */
export function documentRef(key: string): string {
  const m = KEY.exec(key);
  return m ? m[2] : "(malformed key)";
}

class Collector {
  readonly report: Report = { rows: 0, objects: 0, matched: 0, usableRows: 0, inProgressUploads: 0, checksumsVerified: 0, findings: {} };
  add(kind: Finding, ref?: string, count = 1): void {
    const f = (this.report.findings[kind] ??= { count: 0, samples: [] });
    f.count += count;
    if (ref && f.samples.length < SAMPLE_LIMIT && !f.samples.includes(ref)) f.samples.push(ref);
  }
}

/** Pages through a source in strictly increasing key order; a page out of order aborts the check (no false "missing"). */
async function* paged<T>(fetch: (after: string | null, limit: number) => Promise<T[]>, keyOf: (t: T) => string, pageSize: number): AsyncGenerator<T> {
  let after: string | null = null;
  for (;;) {
    const page = await fetch(after, pageSize);
    if (page.length > pageSize) throw new Error("source returned more than one page");
    for (const item of page) {
      const key = keyOf(item);
      if (after !== null && !(key > after)) throw new Error("source keys are not strictly increasing; refusing to compare");
      after = key;
      yield item;
    }
    if (page.length < pageSize) return;
  }
}

const USABLE = new Set(["AVAILABLE", "ARCHIVED"]);

/**
 * Compares rows with objects in one merge pass (bounded memory: one page of
 * each at a time). Returns the report and, when requested, up to maxChecksums
 * files to re-hash afterwards (outside the database transaction).
 */
export async function compare(source: ConsistencySource, opts: { pageSize?: number; maxChecksums?: number } = {}): Promise<{ report: Report; checksumTargets: ChecksumTarget[] }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxChecksums = opts.maxChecksums ?? 0;
  const c = new Collector();
  const checksumTargets: ChecksumTarget[] = [];

  const bucket = await source.bucket();
  if (!bucket.exists) c.add("bucket_missing");
  else {
    if (bucket.public !== false) c.add("bucket_public");
    const types = [...(bucket.mimeTypes ?? [])].sort().join(",");
    if (bucket.fileSizeLimit !== EXPECTED.fileSizeLimit || types !== [...EXPECTED.mimeTypes].sort().join(",")) c.add("bucket_settings_differ");
  }
  if (bucket.rls !== true) c.add("storage_rls_disabled");
  if (bucket.policies !== 0) c.add("storage_policies_present", undefined, bucket.policies);

  const rows = paged(source.rows.bind(source), (r) => r.storageKey, pageSize);
  const objects = paged(source.objects.bind(source), (o) => o.name, pageSize);
  let r = await rows.next();
  let o = await objects.next();

  const rowOnly = (row: DocRow) => {
    if (USABLE.has(row.status)) c.add("missing_object", row.id);
    else if (row.status === "UPLOADING") c.report.inProgressUploads++;
    // FAILED rows without an object are normal (the upload never completed).
  };
  const objectOnly = (obj: StoredObject) => {
    if (KEY.test(obj.name)) c.add("unreferenced_object", documentRef(obj.name));
    else c.add("malformed_object_key", documentRef(obj.name));
  };
  const pair = (row: DocRow, obj: StoredObject) => {
    c.report.matched++;
    if (row.status === "FAILED") return c.add("failed_row_object", row.id);
    if (row.status === "UPLOADING") {
      if (row.stale) c.add("stale_upload_object", row.id);
      else c.report.inProgressUploads++;
      return;
    }
    if (!USABLE.has(row.status)) return;
    if (obj.size === null) c.add("size_unknown", row.id);
    else if (obj.size !== row.sizeBytes) c.add("size_mismatch", row.id);
    if (obj.mimetype !== null && obj.mimetype !== row.mimeType) c.add("type_mismatch", row.id);
    if (maxChecksums > 0) {
      if (checksumTargets.length < maxChecksums) checksumTargets.push({ id: row.id, key: row.storageKey, sha256: row.sha256, sizeBytes: row.sizeBytes });
      else c.add("checksums_not_verified", undefined);
    }
  };

  // Merge join on storage key = object name (both sides strictly increasing).
  while (!r.done || !o.done) {
    if (o.done || (!r.done && r.value.storageKey < o.value.name)) {
      countRow(r.value as DocRow);
      rowOnly(r.value as DocRow);
      r = await rows.next();
    } else if (r.done || o.value.name < r.value.storageKey) {
      c.report.objects++;
      objectOnly(o.value);
      o = await objects.next();
    } else {
      countRow(r.value);
      c.report.objects++;
      pair(r.value, o.value);
      r = await rows.next();
      o = await objects.next();
    }
  }
  return { report: c.report, checksumTargets };

  function countRow(row: DocRow) {
    c.report.rows++;
    if (USABLE.has(row.status)) c.report.usableRows++;
    const m = KEY.exec(row.storageKey);
    if (row.storageKey !== `${row.clinicId}/${row.id}` || !m) c.add("key_ownership", row.id);
  }
}

/** Re-hashes the given files (sequentially, in memory only) and records mismatches in the report. */
export async function verifyChecksums(report: Report, targets: ChecksumTarget[], read: (key: string) => Promise<Uint8Array>): Promise<void> {
  const c = Object.assign(new Collector(), { report });
  for (const t of targets) {
    let bytes: Uint8Array;
    try {
      bytes = await read(t.key);
    } catch {
      c.add("unreadable_object", t.id);
      continue;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== t.sha256 || bytes.byteLength !== t.sizeBytes) c.add("checksum_mismatch", t.id);
    else report.checksumsVerified++;
  }
}

export function failed(report: Report): boolean {
  return Object.keys(report.findings).some((k) => FAILURES.has(k as Finding));
}

/** Human-readable summary: counts and document ids only. */
export function formatReport(report: Report, checksumsRequested: boolean): string {
  const lines = [
    `Rows: ${report.rows} (${report.usableRows} AVAILABLE/ARCHIVED, ${report.inProgressUploads} upload(s) in progress). Objects: ${report.objects}. Matched: ${report.matched}.`,
    checksumsRequested ? `Checksums verified: ${report.checksumsVerified}.` : "Checksums: not verified (use --verify-checksums).",
  ];
  const entries = Object.entries(report.findings) as [Finding, { count: number; samples: string[] }][];
  if (!entries.length) lines.push("No findings.");
  for (const [kind, f] of entries.sort(([a], [b]) => Number(FAILURES.has(b)) - Number(FAILURES.has(a)) || a.localeCompare(b))) {
    lines.push(`  ${FAILURES.has(kind) ? "FAIL" : "warn"}  ${kind.padEnd(26)} ${f.count}`);
    for (const s of f.samples) lines.push(`          document ${s}`);
    if (f.count > f.samples.length && f.samples.length) lines.push(`          … ${f.count - f.samples.length} more`);
  }
  lines.push(failed(report) ? "RESULT: MISMATCH" : "RESULT: CONSISTENT");
  return lines.join("\n");
}

export function parseArgs(argv: string[]): { verifyChecksums: boolean; maxFiles: number } {
  let verifyChecksums = false;
  let maxFiles = DEFAULT_MAX_FILES;
  for (const a of argv) {
    if (a === "--verify-checksums") verifyChecksums = true;
    else if (/^--max-files=\d+$/.test(a)) maxFiles = Number(a.slice("--max-files=".length));
    else throw new Error(`Unknown argument: ${a.slice(0, 40)}. Use --verify-checksums [--max-files=N].`);
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 10_000) throw new Error("--max-files must be between 1 and 10000.");
  return { verifyChecksums, maxFiles };
}

/** The source over one REPEATABLE READ, READ ONLY transaction (the caller begins and ends it). */
export function pgSource(db: Pick<Client, "query">): ConsistencySource {
  return {
    async bucket() {
      const b = (await db.query<{ public: boolean; file_size_limit: string | null; allowed_mime_types: string[] | null }>(
        `SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = $1`, [BUCKET]
      )).rows[0];
      const rls = (await db.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'storage.objects'::regclass`)).rows[0]?.r ?? null;
      const policies = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`)).rows[0].n);
      return {
        exists: !!b,
        public: b ? b.public : null,
        fileSizeLimit: b?.file_size_limit == null ? null : Number(b.file_size_limit),
        mimeTypes: b?.allowed_mime_types ?? null,
        rls,
        policies,
      };
    },
    async rows(after, limit) {
      return (await db.query<DocRow>(
        `SELECT id::text, "clinicId"::text AS "clinicId", "storageKey" AS "storageKey", status::text, "sizeBytes" AS "sizeBytes",
                "mimeType" AS "mimeType", sha256, "createdAt" < now() - interval '2 hours' AS stale
           FROM patient_documents
          WHERE $1::text IS NULL OR "storageKey" COLLATE "C" > $1::text COLLATE "C"
          ORDER BY "storageKey" COLLATE "C" LIMIT $2`, [after, limit]
      )).rows;
    },
    async objects(after, limit) {
      return (await db.query<{ name: string; size: string | null; mimetype: string | null }>(
        `SELECT name, metadata->>'size' AS size, metadata->>'mimetype' AS mimetype
           FROM storage.objects
          WHERE bucket_id = $1 AND ($2::text IS NULL OR name COLLATE "C" > $2::text COLLATE "C")
          ORDER BY name COLLATE "C" LIMIT $3`, [BUCKET, after, limit]
      )).rows.map((o) => ({ name: o.name, size: o.size !== null && /^\d+$/.test(o.size) ? Number(o.size) : null, mimetype: o.mimetype }));
    },
  };
}

/** Download-only reader for the private bucket (server secret key; bytes stay in memory). Also used by file-backup.ts. */
export function storageReader(): (key: string) => Promise<Uint8Array> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!secret || secret.startsWith("sb_publishable_")) throw new Error("SUPABASE_SECRET_KEY is missing or is not a secret key (value not shown).");
  const bucket = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(BUCKET);
  return async (key) => {
    const { data, error } = await bucket.download(key);
    if (error || !data) throw new Error("download failed");
    return new Uint8Array(await data.arrayBuffer());
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL must be set.");
  const read = args.verifyChecksums ? storageReader() : null;
  const db = new Client(verifiedPgConfig(process.env.DIRECT_URL));
  await db.connect();
  let result: Awaited<ReturnType<typeof compare>>;
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    result = await compare(pgSource(db), { maxChecksums: args.verifyChecksums ? args.maxFiles : 0 });
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
  if (read) await verifyChecksums(result.report, result.checksumTargets, read);
  console.log(formatReport(result.report, args.verifyChecksums));
  return failed(result.report) ? 1 : 0;
}

if (process.argv[1] && /storage-consistency\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      const s = errorSummary(err);
      const known = err instanceof Error && /^(DIRECT_URL|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SECRET_KEY|Unknown argument|--max-files|source )/.test(err.message);
      console.error(`Could not verify storage consistency: ${known ? (err as Error).message : [s.kind, s.code, s.sqlState].filter(Boolean).join(" ")}`);
      process.exit(2);
    }
  );
}

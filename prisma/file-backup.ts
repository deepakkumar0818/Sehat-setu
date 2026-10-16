// Patient-file backup (operator tool). Provider-independent; DRY RUN by default.
//
//   npm run storage:backup                                        # dry run: counts only, reads no files, writes nothing
//   npm run storage:backup -- --destination=<kind>:<target>       # dry run that also checks what the destination holds
//   npm run storage:backup -- --destination=<kind>:<target> --apply   # copy new files, write a manifest
//   npm run storage:backup -- --destination=<kind>:<target> --verify  # re-hash existing backup copies (no writes)
//
// STATUS: no destination is approved, so DESTINATIONS below is empty and
// --apply / --verify refuse to run. A destination (provider, region,
// credentials, encryption, retention) is an owner decision; see "Backup and
// recovery runbook" in docs/security.md. Nothing here assumes one.
//
// What a run does:
//   * reads the AVAILABLE/ARCHIVED patient_documents rows in one REPEATABLE
//     READ, READ ONLY transaction (rolled back); its start time is the
//     manifest's snapshotAt — the database point this file set matches;
//   * incremental: a file already listed in the destination's latest manifest
//     is skipped; others are read from the private bucket (server secret key,
//     in memory only), checked against the row's SHA-256 and size, written to
//     the destination WRITE-ONCE (an existing copy is never replaced), and
//     read back and re-hashed;
//   * writes a new, write-once manifest: one JSON header line, then one line
//     per file { storageKey, sha256, sizeBytes, backedUpAt } — every file in
//     the backup set, old and new, so the latest manifest is always complete.
//
// Logs carry counts and document ids only — never clinic ids, storage keys,
// checksums, names or file contents (the manifest itself lives only in the
// destination). Exit code: 0 success, 1 findings (copy/verify failures,
// mismatches, files deferred by --max-files), 2 could not run.
import { createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";
import { verifiedPgConfig } from "../src/server/db/tls";
import { errorSummary } from "../src/server/log";
import { documentRef, pgSource, SAMPLE_LIMIT, storageReader } from "./storage-consistency";

config({ path: [".env.local", ".env"], quiet: true });

export const MANIFEST_FORMAT = "sehat-setu.file-backup.v1";
const MAX_SIZE = 8 * 1024 * 1024;
const MAX_ROWS = 200_000;
const DEFAULT_MAX_FILES = 500;
const MAX_CONSECUTIVE_DESTINATION_ERRORS = 5;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = new RegExp(`^${UUID}/${UUID}$`);
const SHA = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// --- Interfaces -----------------------------------------------------------------

/** A file the database says must be backed up (an AVAILABLE or ARCHIVED row). */
export type SourceFile = { id: string; clinicId: string; storageKey: string; sha256: string; sizeBytes: number };

export interface BackupSource {
  /** Usable rows from one consistent database snapshot, and that snapshot's time. */
  snapshot(): Promise<{ snapshotAt: string; files: SourceFile[] }>;
  /** File bytes from the private bucket (in memory). */
  read(storageKey: string): Promise<Uint8Array>;
}

/**
 * The integration point for an approved backup store. Implementations must be
 * WRITE-ONCE: putFileIfAbsent / putManifestIfAbsent never replace an existing
 * object (return "exists" instead), ideally enforced by the store itself
 * (object lock / no-overwrite credentials), not only by this code.
 */
export interface BackupDestination {
  readonly name: string;
  statFile(storageKey: string): Promise<{ sizeBytes: number } | null>;
  readFile(storageKey: string): Promise<Uint8Array>;
  putFileIfAbsent(storageKey: string, bytes: Uint8Array): Promise<"written" | "exists">;
  listManifests(): Promise<string[]>;
  readManifest(name: string): Promise<string>;
  putManifestIfAbsent(name: string, text: string): Promise<"written" | "exists">;
}

/**
 * Approved destination kinds, by the prefix of --destination=<kind>:<target>.
 * EMPTY until the owner approves a provider, region, credentials, encryption
 * and retention. Register an adapter here (and nowhere else) once approved.
 */
export const DESTINATIONS: Readonly<Record<string, (target: string) => BackupDestination>> = {};

// --- Manifest ---------------------------------------------------------------------

export type ManifestEntry = { storageKey: string; sha256: string; sizeBytes: number; backedUpAt: string };
export type ManifestHeader = { format: typeof MANIFEST_FORMAT; runId: string; snapshotAt: string; createdAt: string; complete: boolean; files: number };

export class ManifestError extends Error {
  constructor(what: string) {
    super(`backup manifest is invalid (${what}); refusing to continue`);
    this.name = "ManifestError";
  }
}

function validEntry(e: unknown): e is ManifestEntry {
  const x = e as ManifestEntry;
  return !!x && typeof x === "object" && Object.keys(x).length === 4
    && typeof x.storageKey === "string" && KEY.test(x.storageKey)
    && typeof x.sha256 === "string" && SHA.test(x.sha256)
    && Number.isInteger(x.sizeBytes) && x.sizeBytes >= 1 && x.sizeBytes <= MAX_SIZE
    && typeof x.backedUpAt === "string" && ISO.test(x.backedUpAt);
}

export function serializeManifest(header: ManifestHeader, entries: Iterable<ManifestEntry>): string {
  const sorted = [...entries].sort((a, b) => (a.storageKey < b.storageKey ? -1 : 1));
  const lines = [JSON.stringify({ ...header, files: sorted.length })];
  for (const e of sorted) lines.push(JSON.stringify({ storageKey: e.storageKey, sha256: e.sha256, sizeBytes: e.sizeBytes, backedUpAt: e.backedUpAt }));
  return lines.join("\n") + "\n";
}

/** Strict parse: any malformed line, duplicate key or count mismatch rejects the whole manifest. */
export function parseManifest(text: string): { header: ManifestHeader; entries: Map<string, ManifestEntry> } {
  const lines = text.split("\n").filter((l) => l.length > 0);
  let header: ManifestHeader;
  try {
    header = JSON.parse(lines[0] ?? "");
  } catch {
    throw new ManifestError("header");
  }
  if (header?.format !== MANIFEST_FORMAT || !ISO.test(String(header.snapshotAt)) || !Number.isInteger(header.files)) throw new ManifestError("header");
  const entries = new Map<string, ManifestEntry>();
  for (const line of lines.slice(1)) {
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      throw new ManifestError("entry");
    }
    if (!validEntry(e) || entries.has(e.storageKey)) throw new ManifestError("entry");
    entries.set(e.storageKey, e);
  }
  if (entries.size !== header.files) throw new ManifestError("count");
  return { header, entries };
}

/** Sortable, write-once manifest name: snapshot time first, then a random run id. */
export function manifestName(snapshotAt: string, runId: string): string {
  return `manifests/${snapshotAt.replace(/[:.]/g, "-")}_${runId}.jsonl`;
}

async function latestManifest(dest: BackupDestination): Promise<{ name: string; header: ManifestHeader; entries: Map<string, ManifestEntry> } | null> {
  const names = (await dest.listManifests()).filter((n) => /^manifests\/[\w-]+\.jsonl$/.test(n)).sort();
  const name = names.at(-1);
  if (!name) return null;
  return { name, ...parseManifest(await dest.readManifest(name)) };
}

// --- Reporting ----------------------------------------------------------------------

export type Finding =
  | "key_ownership" | "source_unreadable" | "source_mismatch" | "destination_error" | "write_verify_failed"
  | "backup_conflict" | "backup_missing" | "backup_corrupt" | "deferred" | "not_backed_up";

export type BackupReport = {
  mode: "dry-run" | "apply" | "verify";
  destination: string | null;
  snapshotAt: string | null;
  usableFiles: number;
  alreadyBackedUp: number;
  copied: number;
  adopted: number;
  wouldCopy: number;
  verified: number;
  manifest: "written" | "not written" | null;
  findings: Partial<Record<Finding, { count: number; samples: string[] }>>;
};

/** Findings that are warnings only (exit 0). Everything else exits 1. */
const WARNINGS: ReadonlySet<Finding> = new Set<Finding>(["not_backed_up"]);

function newReport(mode: BackupReport["mode"], destination: BackupDestination | null): BackupReport {
  return { mode, destination: destination?.name ?? null, snapshotAt: null, usableFiles: 0, alreadyBackedUp: 0, copied: 0, adopted: 0, wouldCopy: 0, verified: 0, manifest: null, findings: {} };
}

function add(report: BackupReport, kind: Finding, storageKey?: string): void {
  const f = (report.findings[kind] ??= { count: 0, samples: [] });
  f.count++;
  const ref = storageKey === undefined ? undefined : documentRef(storageKey);
  if (ref && f.samples.length < SAMPLE_LIMIT && !f.samples.includes(ref)) f.samples.push(ref);
}

export function backupFailed(report: BackupReport): boolean {
  return Object.keys(report.findings).some((k) => !WARNINGS.has(k as Finding));
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

class DestinationUnavailable extends Error {
  constructor() {
    super(`backup destination failed ${MAX_CONSECUTIVE_DESTINATION_ERRORS} times in a row; stopping`);
    this.name = "DestinationUnavailable";
  }
}

// --- Backup (dry run / apply) ----------------------------------------------------------

/**
 * Dry run unless apply is true. A dry run never reads a patient file and never
 * writes; with a destination it only lists manifests and stats files.
 */
export async function runBackup(
  source: BackupSource,
  destination: BackupDestination | null,
  opts: { apply: boolean; maxFiles?: number; now?: () => Date; runId?: string }
): Promise<BackupReport> {
  if (opts.apply && !destination) throw new Error("--apply needs an approved --destination");
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const now = opts.now ?? (() => new Date());
  const report = newReport(opts.apply ? "apply" : "dry-run", destination);

  const { snapshotAt, files } = await source.snapshot();
  report.snapshotAt = snapshotAt;
  report.usableFiles = files.length;
  const latest = destination ? await latestManifest(destination) : null;
  const entries = new Map(latest?.entries ?? []); // the new manifest is a superset of the latest one
  let processed = 0;
  let consecutiveDestinationErrors = 0;
  const destinationError = (key: string) => {
    add(report, "destination_error", key);
    if (++consecutiveDestinationErrors >= MAX_CONSECUTIVE_DESTINATION_ERRORS) throw new DestinationUnavailable();
  };

  for (const file of files) {
    const key = file.storageKey;
    if (!KEY.test(key) || key !== `${file.clinicId}/${file.id}` || !SHA.test(file.sha256)) {
      add(report, "key_ownership", key);
      continue;
    }
    const prior = entries.get(key);
    if (prior) {
      // Files are write-once at the source too, so a different checksum means something is wrong — never "update" the copy.
      if (prior.sha256 !== file.sha256 || prior.sizeBytes !== file.sizeBytes) add(report, "backup_conflict", key);
      else report.alreadyBackedUp++;
      continue;
    }
    if (processed >= maxFiles) {
      add(report, "deferred", key);
      continue;
    }
    processed++;

    let existing: { sizeBytes: number } | null = null;
    if (destination) {
      try {
        existing = await destination.statFile(key);
        // With --apply only a successful WRITE ends an error streak (a store can answer stats yet refuse writes).
        if (!opts.apply) consecutiveDestinationErrors = 0;
      } catch {
        destinationError(key);
        continue;
      }
    }
    if (!opts.apply) {
      report.wouldCopy++;
      continue;
    }
    const dest = destination as BackupDestination;

    if (existing) {
      // Left by an interrupted run (copied, but no manifest yet). Never overwrite: verify it and adopt it, or flag it.
      if (await copyMatches(dest, key, file)) {
        entries.set(key, { storageKey: key, sha256: file.sha256, sizeBytes: file.sizeBytes, backedUpAt: now().toISOString() });
        report.adopted++;
      } else add(report, "backup_conflict", key);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await source.read(key);
    } catch {
      add(report, "source_unreadable", key);
      continue;
    }
    if (bytes.byteLength !== file.sizeBytes || sha256(bytes) !== file.sha256) {
      add(report, "source_mismatch", key); // never back up bytes that don't match their row
      continue;
    }
    let result: "written" | "exists";
    try {
      result = await dest.putFileIfAbsent(key, bytes);
      consecutiveDestinationErrors = 0;
    } catch {
      destinationError(key);
      continue;
    }
    if (!(await copyMatches(dest, key, file))) {
      add(report, result === "exists" ? "backup_conflict" : "write_verify_failed", key);
      continue;
    }
    entries.set(key, { storageKey: key, sha256: file.sha256, sizeBytes: file.sizeBytes, backedUpAt: now().toISOString() });
    if (result === "written") report.copied++;
    else report.adopted++;
  }

  if (opts.apply) {
    const dest = destination as BackupDestination;
    const runId = opts.runId ?? randomUUID();
    const header: ManifestHeader = { format: MANIFEST_FORMAT, runId, snapshotAt, createdAt: now().toISOString(), complete: !backupFailed(report), files: entries.size };
    // A failure here propagates (exit 2): without a manifest the run is not a usable backup.
    const written = await dest.putManifestIfAbsent(manifestName(snapshotAt, runId), serializeManifest(header, entries.values()));
    if (written !== "written") throw new Error("a manifest with this name already exists; nothing was overwritten");
    report.manifest = "written";
  }
  return report;
}

async function copyMatches(dest: BackupDestination, key: string, expected: { sha256: string; sizeBytes: number }): Promise<boolean> {
  try {
    const bytes = await dest.readFile(key);
    return bytes.byteLength === expected.sizeBytes && sha256(bytes) === expected.sha256;
  } catch {
    return false;
  }
}

// --- Verify (read-only) ------------------------------------------------------------------

/**
 * Re-hashes backup copies listed in the latest manifest (up to maxFiles) and,
 * when a source is given, reports usable files the manifest doesn't cover.
 * Reads only; never writes to the destination or the source.
 */
export async function verifyBackup(destination: BackupDestination, source: BackupSource | null, opts: { maxFiles?: number } = {}): Promise<BackupReport> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const report = newReport("verify", destination);
  const latest = await latestManifest(destination);
  if (!latest) throw new Error("the destination has no backup manifest to verify");
  report.snapshotAt = latest.header.snapshotAt;
  let checked = 0;
  for (const e of latest.entries.values()) {
    if (checked++ >= maxFiles) {
      add(report, "deferred", e.storageKey);
      continue;
    }
    let stat: { sizeBytes: number } | null;
    try {
      stat = await destination.statFile(e.storageKey);
    } catch {
      add(report, "destination_error", e.storageKey);
      continue;
    }
    if (!stat) add(report, "backup_missing", e.storageKey);
    else if (await copyMatches(destination, e.storageKey, e)) report.verified++;
    else add(report, "backup_corrupt", e.storageKey);
  }
  if (source) {
    const { files } = await source.snapshot();
    report.usableFiles = files.length;
    for (const f of files) {
      const e = latest.entries.get(f.storageKey);
      if (!e) add(report, "not_backed_up", f.storageKey);
      else if (e.sha256 !== f.sha256 || e.sizeBytes !== f.sizeBytes) add(report, "backup_conflict", f.storageKey);
    }
  }
  return report;
}

// --- Output ------------------------------------------------------------------------------

/** Counts and document ids only. */
export function formatBackupReport(r: BackupReport): string {
  const lines = [
    `Mode: ${r.mode}. Destination: ${r.destination ?? "none configured"}. Database snapshot: ${r.snapshotAt ?? "n/a"}.`,
    `Usable files: ${r.usableFiles}. Already backed up: ${r.alreadyBackedUp}. Copied: ${r.copied}. Adopted (verified existing copies): ${r.adopted}. Would copy: ${r.wouldCopy}. Verified: ${r.verified}.`,
  ];
  if (r.manifest) lines.push(`Manifest: ${r.manifest}.`);
  const entries = Object.entries(r.findings) as [Finding, { count: number; samples: string[] }][];
  if (!entries.length) lines.push("No findings.");
  for (const [kind, f] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${WARNINGS.has(kind) ? "warn" : "FAIL"}  ${kind.padEnd(20)} ${f.count}`);
    for (const s of f.samples) lines.push(`          document ${s}`);
    if (f.count > f.samples.length && f.samples.length) lines.push(`          … ${f.count - f.samples.length} more`);
  }
  if (r.mode === "dry-run") lines.push("Dry run: no file was read and nothing was written.");
  lines.push(backupFailed(r) ? "RESULT: FAILED" : "RESULT: OK");
  return lines.join("\n");
}

// --- CLI -----------------------------------------------------------------------------------

export type BackupArgs = { mode: "dry-run" | "apply" | "verify"; destination: { kind: string; target: string } | null; maxFiles: number };

export function parseBackupArgs(argv: string[]): BackupArgs {
  let apply = false;
  let verify = false;
  let destination: BackupArgs["destination"] = null;
  let maxFiles = DEFAULT_MAX_FILES;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--verify") verify = true;
    else if (a === "--dry-run") continue;
    else if (/^--max-files=\d+$/.test(a)) maxFiles = Number(a.slice("--max-files=".length));
    else if (/^--destination=[a-z][a-z0-9-]*:.+$/.test(a)) {
      const v = a.slice("--destination=".length);
      destination = { kind: v.slice(0, v.indexOf(":")), target: v.slice(v.indexOf(":") + 1) };
    } else throw new Error(`Unknown argument: ${a.slice(0, 40)}. Use [--destination=<kind>:<target>] [--apply | --verify] [--max-files=N].`);
  }
  if (argv.includes("--dry-run")) apply = false;
  if (apply && verify) throw new Error("--apply and --verify can't be combined.");
  if ((apply || verify) && !destination) throw new Error(`--${apply ? "apply" : "verify"} needs --destination=<kind>:<target>.`);
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 10_000) throw new Error("--max-files must be between 1 and 10000.");
  return { mode: apply ? "apply" : verify ? "verify" : "dry-run", destination, maxFiles };
}

/** Resolves --destination against the approved registry. Unknown kinds are refused — nothing is guessed. */
export function resolveDestination(spec: BackupArgs["destination"], registry: Readonly<Record<string, (target: string) => BackupDestination>> = DESTINATIONS): BackupDestination | null {
  if (!spec) return null;
  const make = Object.hasOwn(registry, spec.kind) ? registry[spec.kind] : undefined;
  if (!make) {
    const kinds = Object.keys(registry);
    throw new Error(`Backup destination kind "${spec.kind.slice(0, 20)}" is not approved. ${kinds.length ? `Approved: ${kinds.join(", ")}.` : "No backup destination has been approved yet (owner decision; see docs/security.md)."}`);
  }
  return make(spec.target);
}

/** The live source: usable rows from one READ ONLY snapshot on DIRECT_URL, file bytes via the server secret key. */
function liveSource(): BackupSource {
  let read: ((key: string) => Promise<Uint8Array>) | null = null;
  return {
    async snapshot() {
      if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL must be set.");
      const db = new Client(verifiedPgConfig(process.env.DIRECT_URL));
      await db.connect();
      try {
        await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const snapshotAt = new Date((await db.query<{ t: Date }>("SELECT now() AS t")).rows[0].t).toISOString();
        const rows = pgSource(db);
        const files: SourceFile[] = [];
        for (let after: string | null = null; ; ) {
          const page = await rows.rows(after, 500);
          for (const r of page) {
            if (r.status === "AVAILABLE" || r.status === "ARCHIVED") files.push({ id: r.id, clinicId: r.clinicId, storageKey: r.storageKey, sha256: r.sha256, sizeBytes: r.sizeBytes });
          }
          if (files.length > MAX_ROWS) throw new Error(`more than ${MAX_ROWS} files; run limits need raising deliberately`);
          if (page.length < 500) break;
          after = page[page.length - 1].storageKey;
        }
        return { snapshotAt, files };
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        await db.end();
      }
    },
    async read(key) {
      read ??= storageReader();
      return read(key);
    },
  };
}

async function main(): Promise<number> {
  const args = parseBackupArgs(process.argv.slice(2));
  const destination = resolveDestination(args.destination);
  const source = liveSource();
  const report = args.mode === "verify"
    ? await verifyBackup(destination as BackupDestination, source, { maxFiles: args.maxFiles })
    : await runBackup(source, destination, { apply: args.mode === "apply", maxFiles: args.maxFiles });
  console.log(formatBackupReport(report));
  return backupFailed(report) ? 1 : 0;
}

if (process.argv[1] && /file-backup\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      const s = errorSummary(err);
      const known = err instanceof Error && /^(DIRECT_URL|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SECRET_KEY|Unknown argument|--|Backup destination kind|backup manifest|backup destination failed|the destination has no|a manifest with this name|more than )/.test(err.message);
      console.error(`Backup did not run to completion: ${known ? (err as Error).message : [s.kind, s.code, s.sqlState].filter(Boolean).join(" ")}`);
      process.exit(2);
    }
  );
}

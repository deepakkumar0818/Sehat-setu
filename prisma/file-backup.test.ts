import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  backupFailed,
  DESTINATIONS,
  formatBackupReport,
  MANIFEST_FORMAT,
  ManifestError,
  manifestName,
  parseBackupArgs,
  parseManifest,
  resolveDestination,
  runBackup,
  serializeManifest,
  verifyBackup,
  type BackupDestination,
  type BackupSource,
  type SourceFile,
} from "./file-backup";

// Synthetic, in-memory fixtures only: no database, no Storage, no files on disk.
const CLINIC = "11111111-1111-4111-8111-111111111111";
const doc = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => `${CLINIC}/${doc(n)}`;
const content = (n: number) => new TextEncoder().encode(`ZZTEST synthetic file ${n}`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const file = (n: number, over: Partial<SourceFile> = {}): SourceFile => ({ id: doc(n), clinicId: CLINIC, storageKey: key(n), sha256: sha(content(n)), sizeBytes: content(n).byteLength, ...over });
const SNAPSHOT = "2026-10-14T10:00:00.000Z";
let tick = 0;
const clock = () => new Date(Date.parse("2026-10-14T10:05:00.000Z") + 1000 * tick++);

function memorySource(files: SourceFile[], bytes: Record<string, Uint8Array> = {}) {
  const read = vi.fn(async (k: string) => {
    const b = bytes[k] ?? Object.fromEntries(files.map((f, i) => [f.storageKey, content(Number(f.id.slice(-12)) || i)]))[k];
    if (!b) throw new Error(`no such object ${k}`);
    return b;
  });
  const source: BackupSource = { snapshot: async () => ({ snapshotAt: SNAPSHOT, files }), read };
  return { source, read };
}

/** Write-once in-memory destination. */
function memoryDestination(opts: { corruptOnWrite?: boolean; failPuts?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const manifests = new Map<string, string>();
  const writes: string[] = [];
  const dest: BackupDestination = {
    name: "memory",
    statFile: async (k) => (files.has(k) ? { sizeBytes: files.get(k)!.byteLength } : null),
    readFile: async (k) => {
      const b = files.get(k);
      if (!b) throw new Error("missing");
      return b;
    },
    putFileIfAbsent: async (k, b) => {
      if (opts.failPuts) throw new Error(`destination down for ${k}`);
      if (files.has(k)) return "exists";
      writes.push(k);
      files.set(k, opts.corruptOnWrite ? new TextEncoder().encode("garbled") : b);
      return "written";
    },
    listManifests: async () => [...manifests.keys()],
    readManifest: async (n) => manifests.get(n)!,
    putManifestIfAbsent: async (n, t) => {
      if (manifests.has(n)) return "exists";
      writes.push(n);
      manifests.set(n, t);
      return "written";
    },
  };
  const latest = () => parseManifest(manifests.get([...manifests.keys()].sort().at(-1)!)!);
  return { dest, files, manifests, writes, latest };
}

describe("dry run (the default)", () => {
  it("reads no file and writes nothing, with or without a destination", async () => {
    const { source, read } = memorySource([file(1), file(2)]);
    const none = await runBackup(source, null, { apply: false });
    expect(none).toMatchObject({ mode: "dry-run", usableFiles: 2, wouldCopy: 2, copied: 0, manifest: null });
    const d = memoryDestination();
    const withDest = await runBackup(source, d.dest, { apply: false });
    expect(withDest.wouldCopy).toBe(2);
    expect(read).not.toHaveBeenCalled();
    expect(d.writes).toEqual([]);
    expect(formatBackupReport(withDest)).toMatch(/Dry run: no file was read and nothing was written/);
    expect(parseBackupArgs([])).toMatchObject({ mode: "dry-run", destination: null });
  });

  it("--apply without a destination is refused", async () => {
    await expect(runBackup(memorySource([file(1)]).source, null, { apply: true })).rejects.toThrow(/approved --destination/);
  });
});

describe("apply: incremental, verified, write-once", () => {
  it("copies files, re-hashes them and writes a manifest with key, SHA-256, size and timestamp", async () => {
    const d = memoryDestination();
    const r = await runBackup(memorySource([file(1), file(2)]).source, d.dest, { apply: true, now: clock, runId: "run-1" });
    expect(r).toMatchObject({ mode: "apply", copied: 2, manifest: "written", findings: {} });
    expect(backupFailed(r)).toBe(false);
    expect([...d.manifests.keys()]).toEqual([manifestName(SNAPSHOT, "run-1")]);
    const { header, entries } = d.latest();
    expect(header).toMatchObject({ format: MANIFEST_FORMAT, runId: "run-1", snapshotAt: SNAPSHOT, complete: true, files: 2 });
    expect(entries.get(key(1))).toEqual({ storageKey: key(1), sha256: file(1).sha256, sizeBytes: file(1).sizeBytes, backedUpAt: expect.stringMatching(/^2026-10-14T10:05/) });
    expect(d.files.get(key(2))).toEqual(content(2));
  });

  it("a second run copies only new files and keeps earlier timestamps", async () => {
    const d = memoryDestination();
    await runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock, runId: "run-1" });
    const firstAt = d.latest().entries.get(key(1))!.backedUpAt;
    const { source, read } = memorySource([file(1), file(2)]);
    const r = await runBackup(source, d.dest, { apply: true, now: clock, runId: "run-2" });
    expect(r).toMatchObject({ alreadyBackedUp: 1, copied: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(d.manifests.size).toBe(2);
    const { entries } = d.latest();
    expect(entries.size).toBe(2);
    expect(entries.get(key(1))!.backedUpAt).toBe(firstAt);
  });

  it("never overwrites: a different existing copy is a conflict and stays untouched", async () => {
    const d = memoryDestination();
    const other = new TextEncoder().encode("ZZTEST other bytes");
    d.files.set(key(1), other);
    const r = await runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock });
    expect(r.findings.backup_conflict).toEqual({ count: 1, samples: [doc(1)] });
    expect(d.files.get(key(1))).toBe(other);
    expect(d.latest().header.complete).toBe(false);
    expect(d.latest().entries.size).toBe(0);
    expect(backupFailed(r)).toBe(true);
  });

  it("adopts a matching copy left by an interrupted run without rewriting it", async () => {
    const d = memoryDestination();
    d.files.set(key(1), content(1));
    const { source, read } = memorySource([file(1)]);
    const r = await runBackup(source, d.dest, { apply: true, now: clock });
    expect(r).toMatchObject({ adopted: 1, copied: 0, findings: {} });
    expect(read).not.toHaveBeenCalled();
    expect(d.writes.filter((w) => !w.startsWith("manifests/"))).toEqual([]);
  });

  it("never backs up bytes that don't match their row; a failed read doesn't stop the run", async () => {
    const d = memoryDestination();
    const { source } = memorySource([file(1), file(2), file(3)], { [key(1)]: new TextEncoder().encode("tampered") });
    source.read = vi.fn(async (k: string) => {
      if (k === key(1)) return new TextEncoder().encode("tampered");
      if (k === key(2)) throw new Error(`storage outage reading ${k}`);
      return content(3);
    });
    const r = await runBackup(source, d.dest, { apply: true, now: clock });
    expect(r.findings.source_mismatch).toEqual({ count: 1, samples: [doc(1)] });
    expect(r.findings.source_unreadable).toEqual({ count: 1, samples: [doc(2)] });
    expect(r.copied).toBe(1);
    expect(d.files.has(key(1))).toBe(false);
    expect([...d.latest().entries.keys()]).toEqual([key(3)]);
  });

  it("a copy that doesn't read back correctly is not listed in the manifest", async () => {
    const d = memoryDestination({ corruptOnWrite: true });
    const r = await runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock });
    expect(r.findings.write_verify_failed).toMatchObject({ count: 1 });
    expect(d.latest().entries.size).toBe(0);
  });

  it("stops after repeated destination errors (exit 2), without writing a manifest", async () => {
    const d = memoryDestination({ failPuts: true });
    const files = Array.from({ length: 8 }, (_, i) => file(i + 1));
    await expect(runBackup(memorySource(files).source, d.dest, { apply: true, now: clock })).rejects.toThrow(/5 times in a row/);
    expect(d.manifests.size).toBe(0);
  });

  it("--max-files defers the rest and marks the manifest incomplete", async () => {
    const d = memoryDestination();
    const r = await runBackup(memorySource([file(1), file(2), file(3)]).source, d.dest, { apply: true, maxFiles: 2, now: clock });
    expect(r.copied).toBe(2);
    expect(r.findings.deferred).toMatchObject({ count: 1 });
    expect(d.latest().header.complete).toBe(false);
    expect(backupFailed(r)).toBe(true);
  });

  it("rows whose key isn't their own clinic/document are refused", async () => {
    const d = memoryDestination();
    const r = await runBackup(memorySource([file(1, { storageKey: `22222222-2222-4222-8222-222222222222/${doc(1)}` })]).source, d.dest, { apply: true, now: clock });
    expect(r.findings.key_ownership).toMatchObject({ count: 1 });
    expect(d.files.size).toBe(0);
  });

  it("a manifest name collision is refused, never overwritten", async () => {
    const d = memoryDestination();
    await runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock, runId: "same" });
    const before = [...d.manifests.values()][0];
    await expect(runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock, runId: "same" })).rejects.toThrow(/already exists/);
    expect([...d.manifests.values()][0]).toBe(before);
  });
});

describe("verify (read-only)", () => {
  it("re-hashes existing copies and reports missing, corrupt and uncovered files without writing", async () => {
    const d = memoryDestination();
    await runBackup(memorySource([file(1), file(2), file(3)]).source, d.dest, { apply: true, now: clock });
    d.files.delete(key(2));
    d.files.set(key(3), new TextEncoder().encode("bit rot"));
    const writesBefore = d.writes.length;
    const r = await verifyBackup(d.dest, memorySource([file(1), file(2), file(3), file(4)]).source);
    expect(r).toMatchObject({ mode: "verify", verified: 1 });
    expect(r.findings.backup_missing).toEqual({ count: 1, samples: [doc(2)] });
    expect(r.findings.backup_corrupt).toEqual({ count: 1, samples: [doc(3)] });
    expect(r.findings.not_backed_up).toEqual({ count: 1, samples: [doc(4)] });
    expect(d.writes.length).toBe(writesBefore);
    expect(backupFailed(r)).toBe(true);
  });

  it("an empty destination can't be verified", async () => {
    await expect(verifyBackup(memoryDestination().dest, null)).rejects.toThrow(/no backup manifest/);
  });
});

describe("manifest format", () => {
  const header = { format: MANIFEST_FORMAT, runId: "r", snapshotAt: SNAPSHOT, createdAt: SNAPSHOT, complete: true, files: 1 } as const;
  const entry = { storageKey: key(1), sha256: file(1).sha256, sizeBytes: 10, backedUpAt: SNAPSHOT };

  it("round-trips", () => {
    expect(parseManifest(serializeManifest(header, [entry])).entries.get(key(1))).toEqual(entry);
  });

  it.each([
    ["bad header", "not json\n"],
    ["wrong format", JSON.stringify({ ...header, format: "other" }) + "\n"],
    ["count mismatch", JSON.stringify({ ...header, files: 2 }) + "\n" + JSON.stringify(entry) + "\n"],
    ["bad checksum", JSON.stringify(header) + "\n" + JSON.stringify({ ...entry, sha256: "xyz" }) + "\n"],
    ["path-like key", JSON.stringify(header) + "\n" + JSON.stringify({ ...entry, storageKey: "../../etc/passwd" }) + "\n"],
    ["extra field", JSON.stringify(header) + "\n" + JSON.stringify({ ...entry, patientName: "ZZTEST" }) + "\n"],
    ["duplicate key", JSON.stringify({ ...header, files: 2 }) + "\n" + JSON.stringify(entry) + "\n" + JSON.stringify(entry) + "\n"],
  ])("rejects %s (fail closed)", (_l, text) => {
    expect(() => parseManifest(text)).toThrow(ManifestError);
  });

  it("a corrupt latest manifest stops the run (exit 2)", async () => {
    const d = memoryDestination();
    d.manifests.set("manifests/2026-10-14T10-00-00-000Z_x.jsonl", "garbage");
    await expect(runBackup(memorySource([file(1)]).source, d.dest, { apply: true, now: clock })).rejects.toThrow(ManifestError);
    expect(d.files.size).toBe(0);
  });
});

describe("logs carry counts and document ids only", () => {
  it("no clinic ids, storage keys, checksums or file contents", async () => {
    const d = memoryDestination();
    d.files.set(key(1), new TextEncoder().encode("ZZTEST conflicting"));
    const r = await runBackup(memorySource([file(1), file(2)]).source, d.dest, { apply: true, now: clock });
    const out = formatBackupReport(r);
    for (const s of [CLINIC, key(1), key(2), file(1).sha256, file(2).sha256, "ZZTEST"]) expect(out).not.toContain(s);
    expect(out).toContain(doc(1));
  });
});

describe("configuration: nothing is assumed", () => {
  it("no destination is approved, so --apply and --verify cannot reach any store", () => {
    expect(Object.keys(DESTINATIONS)).toEqual([]);
    expect(() => resolveDestination({ kind: "s3", target: "bucket" })).toThrow(/No backup destination has been approved yet/);
    expect(() => resolveDestination({ kind: "__proto__", target: "x" })).toThrow(/not approved/);
    expect(resolveDestination(null)).toBeNull();
    const memory = memoryDestination().dest;
    expect(resolveDestination({ kind: "memory", target: "t" }, { memory: () => memory })).toBe(memory);
  });

  it("arguments", () => {
    expect(parseBackupArgs(["--destination=x:y", "--apply"])).toMatchObject({ mode: "apply", destination: { kind: "x", target: "y" } });
    expect(parseBackupArgs(["--destination=x:y", "--apply", "--dry-run"]).mode).toBe("dry-run");
    expect(() => parseBackupArgs(["--apply"])).toThrow(/needs --destination/);
    expect(() => parseBackupArgs(["--verify"])).toThrow(/needs --destination/);
    expect(() => parseBackupArgs(["--destination=x:y", "--apply", "--verify"])).toThrow(/can't be combined/);
    expect(() => parseBackupArgs(["--force"])).toThrow(/Unknown argument/);
    expect(() => parseBackupArgs(["--max-files=0"])).toThrow(/between/);
  });

  it("source: database access is a READ ONLY snapshot; Storage is download-only; no local file writes", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "file-backup.ts"), "utf8");
    expect(src).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    expect(src).not.toMatch(/\bCOMMIT\b|\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|\w+\s+SET)\b/);
    expect(src).not.toMatch(/createClient|\.storage\b|\.(upload|remove|move|copy)\(/);
    expect(src).not.toMatch(/node:fs|writeFile|createWriteStream/);
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  compare,
  documentRef,
  failed,
  formatReport,
  parseArgs,
  pgSource,
  SAMPLE_LIMIT,
  verifyChecksums,
  type BucketPosture,
  type ConsistencySource,
  type DocRow,
  type StoredObject,
} from "./storage-consistency";

// In-memory fixtures only: nothing here touches a database or Storage.
const CLINIC = "11111111-1111-4111-8111-111111111111";
const doc = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => `${CLINIC}/${doc(n)}`;
const bytesOf = (n: number) => new TextEncoder().encode(`ZZTEST file ${n}`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function row(n: number, over: Partial<DocRow> = {}): DocRow {
  const b = bytesOf(n);
  return { id: doc(n), clinicId: CLINIC, storageKey: key(n), status: "AVAILABLE", sizeBytes: b.byteLength, mimeType: "application/pdf", sha256: sha(b), stale: true, ...over };
}
function obj(n: number, over: Partial<StoredObject> = {}): StoredObject {
  return { name: key(n), size: bytesOf(n).byteLength, mimetype: "application/pdf", ...over };
}
const PRIVATE: BucketPosture = { exists: true, public: false, fileSizeLimit: 8 * 1024 * 1024, mimeTypes: ["image/png", "application/pdf", "image/jpeg"], rls: true, policies: 0 };

/** A sorted in-memory source with keyset pagination, recording page requests. */
function source(rows: DocRow[], objects: StoredObject[], bucket: BucketPosture = PRIVATE) {
  const calls: number[] = [];
  const byKey = <T>(list: T[], k: (t: T) => string) => [...list].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
  const page = <T>(list: T[], k: (t: T) => string, after: string | null, limit: number) => {
    calls.push(limit);
    return byKey(list, k).filter((t) => after === null || k(t) > after).slice(0, limit);
  };
  const s: ConsistencySource = {
    bucket: async () => bucket,
    rows: async (after, limit) => page(rows, (r) => r.storageKey, after, limit),
    objects: async (after, limit) => page(objects, (o) => o.name, after, limit),
  };
  return { s, calls };
}

describe("rows vs objects", () => {
  it("a matching set is consistent", async () => {
    const { report } = await compare(source([row(1), row(2, { status: "ARCHIVED" })], [obj(1), obj(2)]).s);
    expect(report).toMatchObject({ rows: 2, objects: 2, matched: 2, usableRows: 2, findings: {} });
    expect(failed(report)).toBe(false);
    expect(formatReport(report, false)).toMatch(/RESULT: CONSISTENT/);
  });

  it("finds missing objects, unreferenced objects, size/type mismatches and key ownership problems", async () => {
    const rows = [
      row(1), // missing object
      row(2), // size mismatch
      row(3), // type mismatch
      row(4, { storageKey: `22222222-2222-4222-8222-222222222222/${doc(4)}` }), // key not derived from its own clinic
      row(5), // size unknown
    ];
    const objects = [obj(2, { size: 999 }), obj(3, { mimetype: "image/png" }), obj(4), obj(5, { size: null }), obj(6), { name: "stray.txt", size: 1, mimetype: null }];
    const { report } = await compare(source(rows, objects).s);
    expect(Object.fromEntries(Object.entries(report.findings).map(([k, v]) => [k, v!.count]))).toEqual({
      missing_object: 2, // row 1, and row 4 (nothing is stored under the foreign key it claims)
      size_mismatch: 1,
      type_mismatch: 1,
      key_ownership: 1,
      size_unknown: 1,
      unreferenced_object: 2, // object 6, and object 4 (its row points to another clinic's key)
      malformed_object_key: 1,
    });
    expect(report.findings.missing_object!.samples).toEqual([doc(1), doc(4)]);
    expect(failed(report)).toBe(true);
    expect(formatReport(report, false)).toMatch(/RESULT: MISMATCH/);
  });

  it("uploads in progress and FAILED rows without objects are normal; their leftover objects are warnings", async () => {
    const rows = [row(1, { status: "UPLOADING", stale: false }), row(2, { status: "FAILED" }), row(3, { status: "FAILED" }), row(4, { status: "UPLOADING", stale: true }), row(5, { status: "UPLOADING", stale: false })];
    const { report } = await compare(source(rows, [obj(3), obj(4), obj(5)]).s);
    expect(report.findings).toEqual({ failed_row_object: { count: 1, samples: [doc(3)] }, stale_upload_object: { count: 1, samples: [doc(4)] } });
    expect(report.inProgressUploads).toBe(2);
    expect(failed(report)).toBe(false);
  });

  it("checks bucket posture: missing, public, RLS off, policies present", async () => {
    const missing = await compare(source([], [], { ...PRIVATE, exists: false, public: null, fileSizeLimit: null, mimeTypes: null }).s);
    expect(Object.keys(missing.report.findings)).toEqual(["bucket_missing"]);
    const open = await compare(source([], [], { ...PRIVATE, public: true, rls: false, policies: 2, fileSizeLimit: 50 }).s);
    expect(Object.keys(open.report.findings).sort()).toEqual(["bucket_public", "bucket_settings_differ", "storage_policies_present", "storage_rls_disabled"]);
    expect(failed(open.report)).toBe(true);
  });

  it("pages through both sides with bounded page sizes", async () => {
    const n = 23;
    const rows = Array.from({ length: n }, (_, i) => row(i + 1));
    const objects = Array.from({ length: n }, (_, i) => obj(i + 1));
    const { s, calls } = source(rows, objects);
    const { report } = await compare(s, { pageSize: 5 });
    expect(report).toMatchObject({ rows: n, objects: n, matched: n, findings: {} });
    expect(Math.max(...calls)).toBe(5);
    expect(calls.length).toBe(2 * Math.ceil((n + 1) / 5));
  });

  it("refuses to compare when a source is out of order (never reports false 'missing' files)", async () => {
    const bad: ConsistencySource = { bucket: async () => PRIVATE, rows: async (after) => (after ? [] : [row(2), row(1)]), objects: async () => [] };
    await expect(compare(bad)).rejects.toThrow(/not strictly increasing/);
  });

  it("samples are capped", async () => {
    const { report } = await compare(source(Array.from({ length: 30 }, (_, i) => row(i + 1)), []).s);
    expect(report.findings.missing_object).toMatchObject({ count: 30 });
    expect(report.findings.missing_object!.samples).toHaveLength(SAMPLE_LIMIT);
    expect(formatReport(report, false)).toMatch(/… 10 more/);
  });
});

describe("checksums", () => {
  it("re-hashes up to the limit and reports mismatches and unreadable files", async () => {
    const rows = [row(1), row(2), row(3), row(4)];
    const { report, checksumTargets } = await compare(source(rows, rows.map((r, i) => obj(i + 1))).s, { maxChecksums: 3 });
    expect(checksumTargets.map((t) => t.id)).toEqual([doc(1), doc(2), doc(3)]);
    expect(report.findings.checksums_not_verified).toMatchObject({ count: 1 });
    const read = vi.fn(async (k: string) => {
      if (k === key(2)) return new TextEncoder().encode("tampered");
      if (k === key(3)) throw new Error(`download failed for ${k}`);
      return bytesOf(1);
    });
    await verifyChecksums(report, checksumTargets, read);
    expect(read).toHaveBeenCalledTimes(3);
    expect(report.checksumsVerified).toBe(1);
    expect(report.findings.checksum_mismatch).toEqual({ count: 1, samples: [doc(2)] });
    expect(report.findings.unreadable_object).toEqual({ count: 1, samples: [doc(3)] });
    expect(failed(report)).toBe(true);
  });

  it("no checksums are read unless requested", async () => {
    const { checksumTargets, report } = await compare(source([row(1)], [obj(1)]).s);
    expect(checksumTargets).toEqual([]);
    expect(formatReport(report, false)).toMatch(/not verified/);
  });
});

describe("output never carries clinic ids, raw keys, checksums or file contents", () => {
  it("prints document ids only", async () => {
    const rows = [row(1), row(2, { status: "ARCHIVED" })];
    const { report, checksumTargets } = await compare(source(rows, [obj(2, { size: 1 }), obj(7)]).s, { maxChecksums: 5 });
    await verifyChecksums(report, checksumTargets, async () => bytesOf(99));
    const out = formatReport(report, true);
    for (const s of [CLINIC, key(1), key(2), key(7), rows[0].sha256, "ZZTEST", "stray"]) expect(out).not.toContain(s);
    expect(out).toContain(doc(1));
    expect(documentRef("../../etc/passwd")).toBe("(malformed key)");
  });
});

describe("arguments", () => {
  it("defaults to no checksum reads; rejects unknown or out-of-range arguments", () => {
    expect(parseArgs([])).toEqual({ verifyChecksums: false, maxFiles: 200 });
    expect(parseArgs(["--verify-checksums", "--max-files=1000"])).toEqual({ verifyChecksums: true, maxFiles: 1000 });
    expect(() => parseArgs(["--apply"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--max-files=0"])).toThrow(/between/);
    expect(() => parseArgs(["--max-files=20000"])).toThrow(/between/);
  });
});

describe("read-only by construction", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "storage-consistency.ts"), "utf8");

  it("runs in one REPEATABLE READ, READ ONLY transaction that is rolled back", () => {
    expect(src).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    expect(src).toMatch(/ROLLBACK/);
    expect(src).not.toMatch(/\bCOMMIT\b/);
  });

  it("has no write path to the database or Storage, and writes no files", () => {
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\s+(INTO|FROM|TABLE|ON|\w+\s+SET)?/);
    expect(src).not.toMatch(/\.(upload|uploadToSignedUrl|remove|move|copy|createSignedUrl|createSignedUrls|getPublicUrl|emptyBucket|deleteBucket|updateBucket|createBucket)\(/);
    // The only Storage call is a download; the only .update( is the hash.
    expect([...src.matchAll(/\.update\(/g)]).toHaveLength(1);
    expect(src).toMatch(/createHash\("sha256"\)\.update\(bytes\)/);
    expect(src.match(/bucket\.\w+\(/g)).toEqual(["bucket.download("]);
    expect(src).not.toMatch(/writeFile|createWriteStream|appendFile/);
  });

  it("the SQL source pages with LIMIT and byte-wise key order", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = { query: vi.fn(async (sql: string, params: unknown[] = []) => (queries.push({ sql, params }), { rows: [] })) };
    const s = pgSource(db as never);
    await s.rows(null, 500);
    await s.objects(key(1), 500);
    expect(queries[0].sql).toMatch(/ORDER BY "storageKey" COLLATE "C" LIMIT \$2/);
    expect(queries[1].sql).toMatch(/ORDER BY name COLLATE "C" LIMIT \$3/);
    expect(queries[1].params).toEqual(["patient-documents", key(1), 500]);
  });
});

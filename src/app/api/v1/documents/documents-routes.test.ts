import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";

// Route-level checks WITHOUT a database: the session is mocked, transactions run
// against a recording fake (so we can prove that invalid uploads never reach the
// registration function or storage), and openDocumentFile is stubbed to check
// the download response headers. Database behaviour is covered by the
// integration tests and verify-rls.

vi.mock("server-only", () => ({}));

let signedIn: TenantContext | null = null;
vi.mock("@/server/auth/session", () => ({
  requireStaff: async (permission: string | readonly string[]) => {
    if (!signedIn) throw new AuthError("UNAUTHENTICATED");
    requirePermission(signedIn, permission);
    return signedIn;
  },
  requireIdentity: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
}));

const db = vi.hoisted(() => ({ executed: [] as { sql: string; values: unknown[] }[], queried: 0 }));
vi.mock("@/server/data/scope", () => ({
  pageArgs: () => ({ page: 1, pageSize: 10, skip: 0, take: 10 }),
  runScoped: async (_ctx: unknown, _db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        db.executed.push({ sql: strings.join("?"), values });
        return 1;
      },
      $queryRaw: async () => {
        db.queried++;
        throw new Error("registration must not be reached");
      },
      patientDocument: { findFirst: async () => null },
    }),
}));

const storage = vi.hoisted(() => ({ puts: 0 }));
vi.mock("@/server/storage/documents", async (orig) => {
  const real = await orig<typeof import("@/server/storage/documents")>();
  return { ...real, documentStorageConfigured: () => true, writeDocument: async () => void storage.puts++ };
});

const files = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>) }));
vi.mock("@/server/data/documents", async (orig) => {
  const real = await orig<typeof import("@/server/data/documents")>();
  return { ...real, openDocumentFile: async () => files.next!() };
});

const fileRoute = await import("./[id]/file/route");
const uploadRoute = await import("../patients/[id]/documents/route");

const DOC = "33333333-3333-4333-8333-333333333333";
const PATIENT = "44444444-4444-4444-8444-444444444444";
const ctx = (permissions: string[]): TenantContext => ({
  authUserId: "a", userId: "55555555-5555-4555-8555-555555555555", email: "x@example.test", name: "X", clinicId: "11111111-1111-4111-8111-111111111111",
  clinicName: "C", branchId: null, roles: ["ADMINISTRATOR"], permissions: new Set(permissions), doctorId: null, careScope: "clinic",
});

async function download(query = "") {
  const res = await fileRoute.GET(new NextRequest(`http://localhost/api/v1/documents/${DOC}/file${query}`), { params: Promise.resolve({ id: DOC }) });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function upload(file: { bytes: Uint8Array; name: string; type: string } | null, fields: Record<string, string>, override?: { contentType?: string; length?: string }) {
  const form = new FormData();
  if (file) form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const encoded = new Request("http://localhost/", { method: "POST", body: form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": override?.contentType ?? encoded.headers.get("content-type")! });
  if (override?.length !== "") headers.set("content-length", override?.length ?? String(body.byteLength));
  const res = await uploadRoute.POST(new NextRequest(`http://localhost/api/v1/patients/${PATIENT}/documents`, { method: "POST", body, headers }), { params: Promise.resolve({ id: PATIENT }) });
  return { status: res.status, json: (await res.json()) as { error?: { code: string; message: string } } };
}

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

beforeEach(() => {
  signedIn = null;
  db.executed = [];
  db.queried = 0;
  storage.puts = 0;
  files.next = null;
});

describe("GET /api/v1/documents/[id]/file", () => {
  it("401 without a session and 403 without a document permission — JSON only, no file", async () => {
    let { res } = await download();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-disposition")).toBeNull();
    signedIn = ctx(["billing.view"]);
    ({ res } = await download());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("404 and 410 are JSON errors without file bytes", async () => {
    signedIn = ctx(["patient_document.view"]);
    files.next = async () => { throw new AuthError("NOT_FOUND"); };
    let { res } = await download();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-disposition")).toBeNull();
    files.next = async () => { throw new DataError("GONE", "archived"); };
    ({ res } = await download());
    expect(res.status).toBe(410);
  });

  it("serves the bytes with safe headers (nosniff, sandbox CSP, no-store, attachment + UTF-8 filename)", async () => {
    signedIn = ctx(["patient_document.view"]);
    files.next = async () => ({ bytes: PDF, mimeType: "application/pdf", filename: "रिपोर्ट \"x\".pdf", disposition: "attachment" });
    const { res, bytes } = await download();
    expect(res.status).toBe(200);
    expect(bytes).toEqual(PDF);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox;/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-length")).toBe(String(PDF.byteLength));
    const cd = res.headers.get("content-disposition")!;
    expect(cd).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/);
    expect(cd).not.toMatch(/[\r\n]/);
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(cd)![1])).toBe("रिपोर्ट _x_.pdf"); // Unicode kept; quotes stripped
  });

  it("images may be shown inline", async () => {
    signedIn = ctx(["patient_document.view"]);
    files.next = async () => ({ bytes: Uint8Array.from([0x89, 0x50]), mimeType: "image/png", filename: "a.png", disposition: "inline" });
    const { res } = await download("?disposition=inline");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
  });
});

describe("POST /api/v1/patients/[id]/documents (refusals before registration and storage)", () => {
  const admin = () => ctx(["patient_document.upload", "lab_report.upload", "patient_document.view"]);

  it("401 / 403 without session or upload permission", async () => {
    expect((await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" })).status).toBe(401);
    signedIn = ctx(["patient_document.view"]);
    expect((await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" })).status).toBe(403);
  });

  it("a role with only administrative upload can't upload clinical files", async () => {
    signedIn = ctx(["patient_document.upload"]);
    expect((await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "LAB_REPORT", title: "x" })).status).toBe(403);
  });

  it("refuses non-multipart bodies, missing lengths and declared sizes over 8 MB without reading them", async () => {
    signedIn = admin();
    expect((await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" }, { contentType: "application/json" })).status).toBe(400);
    expect((await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" }, { length: "" })).status).toBe(400);
    const tooBig = await upload({ bytes: PDF, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" }, { length: String(MAX_DOCUMENT_BYTES + 100 * 1024) });
    expect(tooBig.status).toBe(413);
  });

  it.each([
    ["an EXE renamed .pdf", Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]), "invoice.pdf", "application/pdf", 415, "unsupported_type"],
    ["SVG", enc("<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>"), "scan.png", "image/png", 415, "unsupported_type"],
    ["HTML", enc("<!doctype html><script>x</script>"), "report.pdf", "application/pdf", 415, "unsupported_type"],
    ["an empty file", new Uint8Array(), "a.pdf", "application/pdf", 400, "empty"],
    ["a type mismatch", PDF, "scan.png", "image/png", 415, "type_mismatch"],
  ] as const)("%s is refused, audited by reason code only, and never registered or stored", async (_label, bytes, name, type, status, reason) => {
    signedIn = admin();
    const r = await upload({ bytes, name, type }, { category: "ID_PROOF", title: "Secret title" });
    expect(r.status).toBe(status);
    expect(db.queried).toBe(0);
    expect(storage.puts).toBe(0);
    {
      const audit = db.executed.find((e) => e.sql.includes("app.log_event"))!;
      expect(audit.values).toContain("document.upload_rejected");
      expect(audit.values).toContain(reason);
      expect(JSON.stringify(audit.values)).not.toMatch(/Secret title|invoice\.pdf|scan\.png|report\.pdf/);
    }
  });

  it("an 8 MB + 1 byte file is refused", async () => {
    signedIn = admin();
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF);
    const r = await upload({ bytes: big, name: "a.pdf", type: "application/pdf" }, { category: "ID_PROOF", title: "x" });
    expect(r.status).toBe(413);
    expect(db.queried).toBe(0);
    expect(storage.puts).toBe(0);
  });
});

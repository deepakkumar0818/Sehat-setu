import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { authorizedDocument, readDocument, registeredUpload, supabaseDocumentStore, writeDocument } = await import("./documents");

const CLINIC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

describe("storage gate: keys come only from authorized rows of the caller's clinic", () => {
  it("accepts the key the database derived for this clinic and document", () => {
    expect(registeredUpload(CLINIC, { document_id: DOC, storage_key: `${CLINIC}/${DOC}` }).storageKey).toBe(`${CLINIC}/${DOC}`);
    expect(authorizedDocument(CLINIC, { id: DOC, storageKey: `${CLINIC}/${DOC}`, sha256: "a".repeat(64), status: "AVAILABLE" }).storageKey).toBe(`${CLINIC}/${DOC}`);
  });

  it("refuses another clinic's key, a mismatched document, or a path-like key", () => {
    for (const key of [`${OTHER}/${DOC}`, `${CLINIC}/${OTHER}`, `${CLINIC}/../${OTHER}/${DOC}`, `${CLINIC}/${DOC}/x`, DOC, ""]) {
      expect(() => registeredUpload(CLINIC, { document_id: DOC, storage_key: key }), key).toThrow();
      expect(() => authorizedDocument(CLINIC, { id: DOC, storageKey: key, sha256: "", status: "AVAILABLE" }), key).toThrow();
    }
  });

  it("refuses to read anything that is not AVAILABLE", () => {
    for (const status of ["UPLOADING", "FAILED", "ARCHIVED"]) {
      expect(() => authorizedDocument(CLINIC, { id: DOC, storageKey: `${CLINIC}/${DOC}`, sha256: "", status })).toThrow();
    }
  });

  it("passes the row's key (never anything else) to the object store", async () => {
    const put = vi.fn(async () => {});
    const get = vi.fn(async () => new Uint8Array([1]));
    const upload = registeredUpload(CLINIC, { document_id: DOC, storage_key: `${CLINIC}/${DOC}` });
    await writeDocument(upload, new Uint8Array([1]), "image/png", { put, get });
    await readDocument(authorizedDocument(CLINIC, { id: DOC, storageKey: `${CLINIC}/${DOC}`, sha256: "x", status: "AVAILABLE" }), { put, get });
    expect(put).toHaveBeenCalledWith(`${CLINIC}/${DOC}`, expect.any(Uint8Array), "image/png");
    expect(get).toHaveBeenCalledWith(`${CLINIC}/${DOC}`);
  });

  it("has no store without a usable server secret (publishable keys are refused)", () => {
    const pub = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
    expect(supabaseDocumentStore(pub)).toBeNull();
    expect(supabaseDocumentStore({ ...pub, SUPABASE_SECRET_KEY: "sb_publishable_x" })).toBeNull();
    expect(supabaseDocumentStore({ ...pub, SUPABASE_SECRET_KEY: "sb_secret_test" })).not.toBeNull();
  });
});

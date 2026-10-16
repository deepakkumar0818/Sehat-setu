import "server-only";
import { createClient } from "@supabase/supabase-js";
import { parseSupabasePublicConfig } from "@/lib/auth/config";
import { readSecretKey } from "@/server/supabase-admin";

// The ONLY application module that talks to Supabase Storage (enforced by a
// guard test). Patient files live in one private bucket that browsers can't
// reach: it has no public URLs and storage.objects has RLS with no policies for
// anon/authenticated, so only this server's secret key can read or write it.
//
// This module never decides WHO may access a file. It accepts only:
//   * RegisteredUpload  — made from the row app.begin_patient_document_upload
//                         returned (the database authorized the caller), and
//   * AuthorizedDocument — made from an AVAILABLE row the caller read through RLS
//                         in their own tenant transaction.
// The object key always comes from that row ("<clinicId>/<documentId>"), never
// from a request, and is re-checked against the caller's clinic here. There is
// no delete in the request path: removals are done only by the operator's
// orphan sweep (prisma/p62-orphan-sweep.ts).

export const DOCUMENTS_BUCKET = "patient-documents";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = new RegExp(`^(${UUID})/(${UUID})$`);

declare const registered: unique symbol;
declare const authorized: unique symbol;

/** A storage write the database authorized (see app.begin_patient_document_upload). */
export type RegisteredUpload = { readonly documentId: string; readonly storageKey: string; readonly [registered]: true };
/** A stored file the caller may read: an AVAILABLE row read through RLS. */
export type AuthorizedDocument = { readonly documentId: string; readonly storageKey: string; readonly sha256: string; readonly [authorized]: true };

function checkKey(clinicId: string, documentId: string, storageKey: string): void {
  const m = KEY.exec(storageKey);
  if (!m || m[1] !== clinicId || m[2] !== documentId) throw new Error("storage key does not belong to this clinic/document");
}

/** Only call with the result of app.begin_patient_document_upload in the caller's own tenant transaction. */
export function registeredUpload(clinicId: string, row: { document_id: string; storage_key: string }): RegisteredUpload {
  checkKey(clinicId, row.document_id, row.storage_key);
  return { documentId: row.document_id, storageKey: row.storage_key } as RegisteredUpload;
}

/** Only call with a row read through RLS in the caller's tenant transaction, after checking it is AVAILABLE. */
export function authorizedDocument(clinicId: string, row: { id: string; storageKey: string; sha256: string; status: string }): AuthorizedDocument {
  if (row.status !== "AVAILABLE") throw new Error("only AVAILABLE documents can be read");
  checkKey(clinicId, row.id, row.storageKey);
  return { documentId: row.id, storageKey: row.storageKey, sha256: row.sha256 } as AuthorizedDocument;
}

/** Raw object access (injectable for tests). Implementations must never be handed a key from a request. */
export interface DocumentObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export class StorageUnavailableError extends Error {
  constructor(readonly operation: "put" | "get" | "config") {
    super(`document storage ${operation} failed`);
    this.name = "StorageUnavailableError";
  }
}

let defaultStore: DocumentObjectStore | null | undefined;

/** The Supabase-backed store, or null when this server has no usable secret key. */
export function supabaseDocumentStore(env: Record<string, string | undefined> = process.env): DocumentObjectStore | null {
  const config = parseSupabasePublicConfig({ url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  const key = readSecretKey(env);
  if (!config || !key) return null;
  const bucket = createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(DOCUMENTS_BUCKET);
  return {
    async put(objectKey, bytes, contentType) {
      // upsert: false — an object key is written once; an existing object is never replaced.
      const { error } = await bucket.upload(objectKey, bytes, { contentType, upsert: false, cacheControl: "no-store" });
      if (error) throw new StorageUnavailableError("put");
    },
    async get(objectKey) {
      const { data, error } = await bucket.download(objectKey);
      if (error || !data) throw new StorageUnavailableError("get");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

function store(override?: DocumentObjectStore | null): DocumentObjectStore {
  if (override) return override;
  if (defaultStore === undefined) defaultStore = supabaseDocumentStore();
  if (!defaultStore) throw new StorageUnavailableError("config");
  return defaultStore;
}

export async function writeDocument(upload: RegisteredUpload, bytes: Uint8Array, contentType: string, override?: DocumentObjectStore | null): Promise<void> {
  await store(override).put(upload.storageKey, bytes, contentType);
}

export async function readDocument(doc: AuthorizedDocument, override?: DocumentObjectStore | null): Promise<Uint8Array> {
  return store(override).get(doc.storageKey);
}

/** Whether this server can reach document storage at all (no request is made). */
export function documentStorageConfigured(): boolean {
  return supabaseDocumentStore() !== null;
}

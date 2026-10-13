// P6.2 storage setup — run only with explicit approval.
//
//   npx tsx prisma/p62-storage-setup.ts           # read-only: report whether the bucket exists and how it's configured
//   npx tsx prisma/p62-storage-setup.ts --create  # create the private bucket (idempotent; refuses to change an existing one)
//
// Creates ONE private Supabase Storage bucket, "patient-documents", limited to
// PDF/JPEG/PNG files of at most 8 MB. Private means no public URLs; and because
// storage.objects has RLS enabled with no policies for anon/authenticated, only
// the server's secret key (SUPABASE_SECRET_KEY, server-only) can read or write
// objects. The application then reads or writes an object only after the
// database has authorized that exact row (see the migration 20261021000000).
// Uploads/deletes no files. Never prints the key.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Client } from "pg";
import { verifiedPgConfig } from "../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

export const DOCUMENTS_BUCKET = "patient-documents";
const SETTINGS = { public: false, fileSizeLimit: 8 * 1024 * 1024, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"] };

function secretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || /\[|\]|your-|<|>/i.test(key) || key.startsWith("sb_publishable_") || key === process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    throw new Error("SUPABASE_SECRET_KEY is missing or is not a secret key (value not shown).");
  }
  return key;
}

async function main() {
  const create = process.argv.includes("--create");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  const storage = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage;

  const { data: existing, error: getError } = await storage.getBucket(DOCUMENTS_BUCKET);
  if (existing) {
    const ok = existing.public === false && existing.file_size_limit === SETTINGS.fileSizeLimit
      && JSON.stringify([...(existing.allowed_mime_types ?? [])].sort()) === JSON.stringify([...SETTINGS.allowedMimeTypes].sort());
    console.log(`Bucket "${DOCUMENTS_BUCKET}" exists: public=${existing.public}, limit=${existing.file_size_limit}, types=${(existing.allowed_mime_types ?? []).join(",")}`);
    if (!ok) throw new Error("The existing bucket's settings differ from the approved ones; NOT changed. Fix it deliberately in the Supabase dashboard.");
  } else if (!create) {
    console.log(`Bucket "${DOCUMENTS_BUCKET}" does not exist (${getError?.message ?? "not found"}). Re-run with --create once approved.`);
    return;
  } else {
    const { error } = await storage.createBucket(DOCUMENTS_BUCKET, SETTINGS);
    if (error) throw new Error(`Creating the bucket failed: ${error.message}`);
    console.log(`Created private bucket "${DOCUMENTS_BUCKET}" (8 MB, PDF/JPEG/PNG).`);
  }

  // Posture checks in the database (read-only): private, and no storage policies that would open it to browser roles.
  const db = new Client(verifiedPgConfig(process.env.DIRECT_URL!));
  await db.connect();
  try {
    await db.query("BEGIN TRANSACTION READ ONLY");
    const b = (await db.query(`SELECT public FROM storage.buckets WHERE id = $1`, [DOCUMENTS_BUCKET])).rows[0];
    const rls = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass`)).rows[0].relrowsecurity;
    const policies = (await db.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`)).rows.map((r) => r.policyname);
    await db.query("ROLLBACK");
    console.log(`Database view: bucket public=${b?.public}, storage.objects RLS=${rls}, storage policies=${policies.length ? policies.join(",") : "none"}`);
    if (b?.public !== false || rls !== true || policies.length > 0) throw new Error("Storage posture is NOT private as required. Investigate before uploading anything.");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

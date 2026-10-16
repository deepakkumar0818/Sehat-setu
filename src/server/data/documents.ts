import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/server/auth/errors";
import { assertBranchAccess, hasAnyPermission, requirePermission, type PatientContext, type TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { DataError } from "@/server/api/errors";
import {
  authorizedDocument,
  documentStorageConfigured,
  readDocument,
  registeredUpload,
  StorageUnavailableError,
  writeDocument,
  type DocumentObjectStore,
} from "@/server/storage/documents";
import {
  ADMIN_CATEGORIES,
  CLINICAL_CATEGORIES,
  FILE_REJECTION_MESSAGE,
  checkDocumentBytes,
  isClinicalCategory,
  sanitizeFilename,
  type ArchiveReason,
  type DocumentCategoryKey,
} from "@/lib/documents";
import type { DocumentPage, LiveDocument, UploadResult } from "@/lib/live-types";
import {
  ADMIN_UPLOAD,
  CLINICAL_READ,
  CLINICAL_UPLOAD,
  DOCUMENT_ARCHIVE,
  DOCUMENT_READ,
  DOCUMENT_UPLOAD,
  archiveSchema,
  canOfferArchive,
  dbCall,
  listDocumentsSchema,
  uploadFieldsSchema,
  uuid,
} from "./document-rules";
import { pageArgs, runPatientScoped, runScoped } from "./scope";

// Patient documents (migration 20261021000000_patient_documents).
//
// Reads: plain SELECTs in the caller's tenant transaction — RLS decides which
// rows exist for them (clinical vs administrative, branch scope, doctors' own
// patients across branches, UPLOADING/FAILED never visible).
// Writes: only the app.* SECURITY DEFINER functions, which re-check the caller.
// Files: only through src/server/storage/documents.ts, and only with a row the
// database authorized (upload) or returned through RLS (download).
// Audit metadata carries ids, category, type and size — never titles,
// filenames, file contents or patient names.

export interface DocumentDeps {
  /** Test seam: replaces the Supabase-backed object store. */
  store?: DocumentObjectStore | null;
  now?: Date;
}

const docSelect = {
  id: true, clinicId: true, branchId: true, patientId: true, labReportId: true, consultationId: true, category: true, title: true,
  originalFilename: true, mimeType: true, sizeBytes: true, status: true, uploadedByUserId: true, uploadedAt: true,
  archivedAt: true, archiveReason: true,
} as const;
type DocRow = Prisma.PatientDocumentGetPayload<{ select: typeof docSelect }>;

/** Display names for ids, each looked up through RLS separately (a hidden row just has no name). */
export async function lookupNames(tx: TenantTx, ids: { patients?: string[]; branches?: string[]; users?: string[]; doctors?: string[] }) {
  const uniq = (a?: (string | null)[]) => [...new Set((a ?? []).filter((x): x is string => Boolean(x)))];
  const doctorIds = uniq(ids.doctors);
  const [patients, branches, doctors] = await Promise.all([
    uniq(ids.patients).length ? tx.patient.findMany({ where: { id: { in: uniq(ids.patients) } }, select: { id: true, name: true, patientNumber: true } }) : [],
    uniq(ids.branches).length ? tx.branch.findMany({ where: { id: { in: uniq(ids.branches) } }, select: { id: true, name: true } }) : [],
    doctorIds.length ? tx.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: { id: true, userId: true } }) : [],
  ]);
  const userIds = uniq([...(ids.users ?? []), ...doctors.map((d) => d.userId)]);
  const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return {
    patient: new Map(patients.map((p) => [p.id, p])),
    branch: new Map(branches.map((b) => [b.id, b])),
    user: userName,
    doctor: new Map(doctors.map((d) => [d.id, { id: d.id, name: userName.get(d.userId) ?? "Doctor" }])),
  };
}

export async function toDocumentDtos(ctx: TenantContext, tx: TenantTx, rows: DocRow[], now = new Date()): Promise<LiveDocument[]> {
  const names = await lookupNames(tx, { patients: rows.map((r) => r.patientId), branches: rows.map((r) => r.branchId), users: rows.map((r) => r.uploadedByUserId) });
  return rows.map((r) => {
    const patient = names.patient.get(r.patientId);
    const category = r.category as DocumentCategoryKey;
    return {
      id: r.id,
      patientId: r.patientId,
      patientName: patient?.name ?? null,
      patientNumber: patient?.patientNumber ?? null,
      branch: names.branch.get(r.branchId) ?? null,
      category,
      clinical: isClinicalCategory(category),
      title: r.title,
      filename: r.originalFilename,
      mimeType: r.mimeType as LiveDocument["mimeType"],
      sizeBytes: r.sizeBytes,
      status: r.status as LiveDocument["status"],
      uploadedAt: r.uploadedAt?.toISOString() ?? null,
      uploadedByName: names.user.get(r.uploadedByUserId) ?? null,
      labReportId: r.labReportId,
      consultationId: r.consultationId,
      archivedAt: r.archivedAt?.toISOString() ?? null,
      archiveReason: (r.archiveReason as ArchiveReason | null) ?? null,
      canArchive: canOfferArchive(ctx.permissions, { userId: ctx.userId, doctorId: ctx.doctorId }, { ...r, category }, now),
    };
  });
}

async function logEvent(tx: TenantTx, action: string, outcome: "SUCCESS" | "DENIED" | "FAILURE", targetId: string, reason: string | null, metadata: Record<string, unknown>) {
  await tx.$executeRaw`SELECT app.log_event(${action}, ${outcome}, 'patient_document', ${targetId}, ${reason}, NULL, NULL, ${JSON.stringify(metadata)}::jsonb)`;
}

/** Records an audit event in its own transaction; never throws (the request's own outcome matters more). */
async function logSeparately(ctx: TenantContext, db: TenantTx | undefined, action: string, outcome: "SUCCESS" | "DENIED" | "FAILURE", targetId: string, reason: string, metadata: Record<string, unknown>) {
  try {
    await runScoped(ctx, db, (tx) => logEvent(tx, action, outcome, targetId, reason, metadata));
  } catch (err) {
    console.error(`[documents] couldn't record ${action}`, (err as { code?: string })?.code ?? "error");
  }
}

export function documentCapabilities(ctx: TenantContext) {
  return {
    canUploadClinical: hasAnyPermission(ctx, CLINICAL_UPLOAD),
    canUploadAdministrative: hasAnyPermission(ctx, ADMIN_UPLOAD),
    canViewClinical: hasAnyPermission(ctx, CLINICAL_READ),
  };
}

export async function listDocuments(ctx: TenantContext, raw: unknown, db?: TenantTx, deps: DocumentDeps = {}): Promise<DocumentPage> {
  requirePermission(ctx, [...DOCUMENT_READ, ...DOCUMENT_UPLOAD]);
  const input = listDocumentsSchema.parse(raw);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 60);
  const categoryWhere =
    input.category !== "all" ? { category: input.category }
    : input.kind === "clinical" ? { category: { in: [...CLINICAL_CATEGORIES] } }
    : input.kind === "administrative" ? { category: { in: [...ADMIN_CATEGORIES] } }
    : {};
  const search = input.search ? { contains: input.search, mode: "insensitive" as const } : undefined;
  // RLS limits rows to what the caller may see; the explicit filters keep queries honest.
  const where: Prisma.PatientDocumentWhereInput = {
    clinicId: ctx.clinicId,
    status: input.status === "available" ? "AVAILABLE" : input.status === "archived" ? "ARCHIVED" : { in: ["AVAILABLE", "ARCHIVED"] },
    ...(input.patientId ? { patientId: input.patientId } : {}),
    ...(input.labReportId ? { labReportId: input.labReportId } : {}),
    ...categoryWhere,
    ...(search ? { OR: [{ title: search }, { patient: { name: search } }, { patient: { patientNumber: search } }] } : {}),
  };
  const now = deps.now ?? new Date();
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.patientDocument.findMany({ where, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], skip, take, select: docSelect }),
      tx.patientDocument.count({ where }),
    ]);
    return {
      items: await toDocumentDtos(ctx, tx, rows, now),
      total,
      page,
      pageSize,
      ...documentCapabilities(ctx),
      storageConfigured: deps.store ? true : documentStorageConfigured(),
    };
  });
}

export async function getDocument(ctx: TenantContext, id: string, db?: TenantTx, now = new Date()): Promise<LiveDocument> {
  requirePermission(ctx, [...DOCUMENT_READ, ...DOCUMENT_UPLOAD]);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    const row = await tx.patientDocument.findFirst({ where: { id, clinicId: ctx.clinicId }, select: docSelect });
    if (!row) throw new AuthError("NOT_FOUND");
    return (await toDocumentDtos(ctx, tx, [row], now))[0];
  });
}

export interface IncomingFile {
  bytes: Uint8Array;
  /** The browser-supplied name and type: used only for checks and a sanitised display name. */
  name: string;
  type: string;
}

/**
 * Upload: (1) validate the bytes here; (2) in one tenant transaction, check for
 * a duplicate, optionally create the lab report, and register the upload with
 * app.begin_patient_document_upload (authorizes the caller, returns the only key
 * we may write); (3) store the bytes; (4) app.complete_patient_document_upload.
 * A storage or completion failure marks the row FAILED (never listed); any
 * object it left behind is removed by the operator's orphan sweep.
 */
export async function uploadDocument(ctx: TenantContext, patientId: string, file: IncomingFile, rawFields: unknown, db?: TenantTx, deps: DocumentDeps = {}): Promise<UploadResult> {
  requirePermission(ctx, DOCUMENT_UPLOAD);
  if (!uuid.safeParse(patientId).success) throw new AuthError("NOT_FOUND");
  const fields = uploadFieldsSchema.parse(rawFields);
  const clinical = isClinicalCategory(fields.category);
  requirePermission(ctx, clinical ? CLINICAL_UPLOAD : ADMIN_UPLOAD);
  if ((fields.labReportId || fields.testType) && fields.category !== "LAB_REPORT") throw new DataError("INVALID_INPUT", "Only lab-report files can be linked to a lab report.");
  if (fields.branchId) assertBranchAccess(ctx, fields.branchId);

  const check = checkDocumentBytes(file.bytes, file.type, file.name);
  if (!check.ok) {
    await logSeparately(ctx, db, "document.upload_rejected", "FAILURE", patientId, check.reason, { patientId, category: fields.category, sizeBytes: file.bytes.length });
    const code = check.reason === "too_large" ? "FILE_TOO_LARGE" : check.reason === "empty" ? "INVALID_INPUT" : "UNSUPPORTED_FILE";
    throw new DataError(code, FILE_REJECTION_MESSAGE[check.reason], { reason: check.reason });
  }
  if (!deps.store && !documentStorageConfigured()) throw new DataError("STORAGE_UNAVAILABLE", "Document storage isn't set up on this server yet.");

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const filename = sanitizeFilename(file.name, check.mimeType);

  const reg = await runScoped(ctx, db, async (tx) => {
    // Only rows the caller can see are compared (an upload-only caller learns nothing about clinical files).
    const dup = await tx.patientDocument.findFirst({ where: { clinicId: ctx.clinicId, patientId, sha256, status: "AVAILABLE" }, select: { id: true } });
    if (dup) throw new DataError("DUPLICATE", "This exact file is already on the patient's record.", { documentId: dup.id });
    let labReportId = fields.labReportId ?? null;
    if (fields.category === "LAB_REPORT" && !labReportId && fields.testType) {
      const created = await dbCall(() => tx.$queryRaw<{ id: string }[]>`
        SELECT app.create_lab_report(${patientId}::uuid, ${fields.testType}, ${fields.title}, ${fields.consultationId ?? null}::uuid, ${fields.branchId ?? null}::uuid)::text AS id`);
      labReportId = created[0].id;
    }
    const rows = await dbCall(() => tx.$queryRaw<{ document_id: string; storage_key: string }[]>`
      SELECT document_id::text AS document_id, storage_key FROM app.begin_patient_document_upload(
        ${patientId}::uuid, ${fields.category}::"DocumentCategory", ${fields.title}, ${filename}, ${check.mimeType}, ${file.bytes.length}::int, ${sha256},
        ${fields.branchId ?? null}::uuid, ${labReportId}::uuid, ${fields.consultationId ?? null}::uuid)`);
    return { upload: registeredUpload(ctx.clinicId, rows[0]), labReportId };
  });

  const id = reg.upload.documentId;
  const fail = async (reason: string) => {
    try {
      await runScoped(ctx, db, (tx) => tx.$executeRaw`SELECT app.fail_patient_document_upload(${id}::uuid, ${reason})`);
    } catch (err) {
      console.error("[documents] couldn't mark an upload failed", (err as { code?: string })?.code ?? "error");
    }
  };
  try {
    await writeDocument(reg.upload, file.bytes, check.mimeType, deps.store);
  } catch (err) {
    console.error("[documents] storage write failed", err instanceof StorageUnavailableError ? err.operation : "error");
    await fail("storage_error");
    throw new DataError("STORAGE_UNAVAILABLE", "The file couldn't be stored. Please try again.");
  }
  try {
    await runScoped(ctx, db, (tx) => dbCall(() => tx.$executeRaw`SELECT app.complete_patient_document_upload(${id}::uuid)`));
  } catch (err) {
    await fail("complete_failed");
    throw err;
  }
  const readable = await runScoped(ctx, db, async (tx) => Boolean(await tx.patientDocument.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { id: true } })));
  return { id, category: fields.category, labReportId: reg.labReportId, readable };
}

export interface DocumentFile {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  disposition: "inline" | "attachment";
}

/**
 * Download/view. One tenant transaction reads the row through RLS and records
 * the access (or the denial) and COMMITS; only then are the bytes fetched, with
 * the key from that row, and checked against the stored SHA-256.
 */
export async function openDocumentFile(ctx: TenantContext, id: string, requested: "inline" | "attachment", db?: TenantTx, deps: DocumentDeps = {}): Promise<DocumentFile> {
  requirePermission(ctx, DOCUMENT_READ);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  // PDFs are always downloaded (browsers' PDF viewers don't run inside a sandboxed response); images may be shown inline.
  const outcome = await runScoped(ctx, db, async (tx) => {
    const row = await tx.patientDocument.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, storageKey: true, sha256: true, status: true, mimeType: true, originalFilename: true, category: true, patientId: true, sizeBytes: true },
    });
    if (!row) {
      await logEvent(tx, "document.access_denied", "DENIED", id, "not_found", {});
      return { kind: "missing" as const };
    }
    const meta = { patientId: row.patientId, category: row.category, clinical: isClinicalCategory(row.category as DocumentCategoryKey) };
    if (row.status !== "AVAILABLE") {
      await logEvent(tx, "document.access_denied", "DENIED", id, "archived", meta);
      return { kind: "archived" as const };
    }
    const disposition = row.mimeType === "application/pdf" ? "attachment" : requested;
    await logEvent(tx, "document.viewed", "SUCCESS", id, null, { ...meta, disposition, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
    return { kind: "ok" as const, row, disposition };
  });
  if (outcome.kind === "missing") throw new AuthError("NOT_FOUND");
  if (outcome.kind === "archived") throw new DataError("GONE", "This document has been archived and can no longer be opened.");

  const { row } = outcome;
  const bytes = await fetchVerified(ctx.clinicId, row, deps, (reason) => logSeparately(ctx, db, "document.view_failed", "FAILURE", id, reason, { patientId: row.patientId }));
  return { bytes, mimeType: row.mimeType, filename: row.originalFilename, disposition: outcome.disposition };
}

type ReadableRow = { id: string; storageKey: string; sha256: string; status: string; sizeBytes: number };

/** Fetches an authorized row's bytes and checks them against the stored size and SHA-256 (failures recorded by `onFailure`). */
async function fetchVerified(clinicId: string, row: ReadableRow, deps: DocumentDeps, onFailure: (reason: string) => Promise<void>): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await readDocument(authorizedDocument(clinicId, row), deps.store);
  } catch (err) {
    console.error("[documents] storage read failed", err instanceof StorageUnavailableError ? err.operation : "error");
    await onFailure("storage_error");
    throw new DataError("STORAGE_UNAVAILABLE", "The file couldn't be loaded. Please try again.");
  }
  if (bytes.length !== row.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
    await onFailure("integrity_mismatch");
    throw new DataError("STORAGE_UNAVAILABLE", "The stored file failed its integrity check and wasn't sent.");
  }
  return bytes;
}

/**
 * Patient portal download (P6.3). The row is read in the patient's own
 * transaction, where RLS (patient_documents_read) exposes only LAB_REPORT files
 * that are AVAILABLE, belong to the patient's linked record and are attached to
 * a report the patient may see (reviewed AND shared). The same rule is checked
 * again here. Every refusal — unknown id, another patient's file, unshared,
 * archived, other category — is the same NOT_FOUND, so nothing reveals that a
 * file exists. The access (or the denial) is audited and committed before the
 * bytes are fetched, exactly as for staff.
 */
export async function openPatientDocumentFile(ctx: PatientContext, id: string, requested: "inline" | "attachment", db?: TenantTx, deps: DocumentDeps = {}): Promise<DocumentFile> {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const outcome = await runPatientScoped(ctx, db, async (tx) => {
    const row = await tx.patientDocument.findFirst({
      where: { id, clinicId: ctx.clinicId, patientId: { in: ctx.patientIds }, category: "LAB_REPORT", status: "AVAILABLE", labReport: { sharedWithPatientAt: { not: null }, status: "REVIEWED" } },
      select: { id: true, storageKey: true, sha256: true, status: true, mimeType: true, originalFilename: true, sizeBytes: true, labReportId: true },
    });
    if (!row) {
      await logEvent(tx, "document.access_denied", "DENIED", id, "not_found", { portal: true });
      return null;
    }
    const disposition = row.mimeType === "application/pdf" ? "attachment" : requested;
    await logEvent(tx, "document.viewed", "SUCCESS", id, null, { portal: true, labReportId: row.labReportId, disposition, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
    return { row, disposition };
  });
  if (!outcome) throw new AuthError("NOT_FOUND");
  const { row } = outcome;
  const bytes = await fetchVerified(ctx.clinicId, row, deps, async (reason) => {
    try {
      await runPatientScoped(ctx, db, (tx) => logEvent(tx, "document.view_failed", "FAILURE", id, reason, { portal: true }));
    } catch (err) {
      console.error("[documents] couldn't record document.view_failed", (err as { code?: string })?.code ?? "error");
    }
  });
  return { bytes, mimeType: row.mimeType, filename: row.originalFilename, disposition: outcome.disposition };
}

export async function archiveDocument(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<LiveDocument> {
  requirePermission(ctx, DOCUMENT_ARCHIVE);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const input = archiveSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    await dbCall(() => tx.$executeRaw`SELECT app.archive_patient_document(${id}::uuid, ${input.reason}::"DocumentArchiveReason", ${input.note ?? null})`);
    const row = await tx.patientDocument.findFirst({ where: { id, clinicId: ctx.clinicId }, select: docSelect });
    if (!row) throw new AuthError("NOT_FOUND");
    return (await toDocumentDtos(ctx, tx, [row], now))[0];
  });
}


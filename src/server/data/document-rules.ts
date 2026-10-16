// Pure rules for patient documents and lab reports (P6.2): input schemas, the
// mapping of database errors ('patient document: CODE' / 'lab report: CODE',
// raised by the app.* functions of migration 20261021000000) to API errors, and
// the UI action hints. No server-only imports, so unit tests can load it.
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { ARCHIVE_REASONS, DOCUMENT_CATEGORIES, LAB_FLAGS, isClinicalCategory, type DocumentCategoryKey } from "@/lib/documents";

export const uuid = z.string().uuid();

/** Clinical reads: any of these lets the database decide (RLS) what the caller sees. */
export const CLINICAL_READ = ["medical_record.view", "medical_record.manage", "lab.manage", "patient.medical_record.view", "lab_report.view"] as const;
export const ADMIN_DOC_READ = ["patient_document.view"] as const;
export const DOCUMENT_READ = [...CLINICAL_READ, ...ADMIN_DOC_READ] as const;
export const DOCUMENT_UPLOAD = ["patient_document.upload", "lab_report.upload"] as const;
export const CLINICAL_UPLOAD = ["lab_report.upload"] as const;
export const ADMIN_UPLOAD = ["patient_document.upload"] as const;
export const DOCUMENT_ARCHIVE = ["patient_document.manage", "lab.manage", "medical_record.manage", "patient.medical_record.view"] as const;
export const LAB_REPORT_CREATE = ["lab_report.upload"] as const;
export const LAB_VALUES_UPDATE = ["lab_result.update", "lab.manage"] as const;
export const LAB_REPORT_REVIEW = ["patient.medical_record.view"] as const;
export const LAB_REPORT_SHARE = ["lab.manage", "medical_record.manage", "patient.medical_record.view"] as const;

export const uploadFieldsSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1, "Enter a title.").max(200),
  branchId: uuid.optional(),
  labReportId: uuid.optional(),
  consultationId: uuid.optional(),
  /** LAB_REPORT only: create a lab-report entry for this file (when no labReportId is given). */
  testType: z.string().trim().min(1).max(60).optional(),
});
export type UploadFields = z.infer<typeof uploadFieldsSchema>;

export const listDocumentsSchema = z.object({
  patientId: uuid.optional(),
  labReportId: uuid.optional(),
  kind: z.enum(["all", "clinical", "administrative"]).default("all"),
  category: z.enum(DOCUMENT_CATEGORIES).or(z.literal("all")).default("all"),
  status: z.enum(["available", "archived", "all"]).default("available"),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export const archiveSchema = z.object({
  reason: z.enum(ARCHIVE_REASONS),
  note: z.string().trim().max(500).optional(),
});

export const createLabReportSchema = z.object({
  patientId: uuid,
  testType: z.string().trim().min(1, "Enter the test.").max(60),
  title: z.string().trim().min(1, "Enter a title.").max(200),
  consultationId: uuid.optional(),
  branchId: uuid.optional(),
});

const cell = z.string().trim().max(120).nullable().optional();
export const labValueSchema = z
  .object({
    parameter: z.string().trim().min(1, "Each row needs a parameter.").max(120),
    value: cell,
    unit: cell,
    range: cell,
    flag: z.enum(LAB_FLAGS).nullable().optional(),
  })
  .strict();

export const setLabValuesSchema = z.object({
  values: z.array(labValueSchema).max(100, "At most 100 values."),
  resultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const listLabReportsSchema = z.object({
  patientId: uuid.optional(),
  status: z.enum(["PENDING", "AVAILABLE", "REVIEWED", "all"]).default("all"),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export function errorText(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  return parts.join(" | ");
}

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  INVALID_FILE: ["UNSUPPORTED_FILE", "Only PDF, JPEG and PNG files up to 8 MB can be uploaded."],
  INVALID_BRANCH: ["INVALID_INPUT", "Choose an active branch you have access to."],
  INVALID_LINK: ["INVALID_INPUT", "The linked lab report or consultation doesn't belong to this patient."],
  INVALID_INPUT: ["INVALID_INPUT", "Some fields are missing or invalid."],
  INVALID_TRANSITION: ["INVALID_TRANSITION", "That can't be done in the record's current state."],
  RATE_LIMITED: ["RATE_LIMITED", "Too many uploads in a short time. Please wait a few minutes and try again."],
  SHARED_LOCKED: ["SHARED_LOCKED", "This report is shared with the patient. Stop sharing it before changing its values."],
  NOT_REVIEWED: ["NOT_REVIEWED", "Only a reviewed report can be shared with the patient."],
};

/** Turns a database refusal from the P6.2 functions into an API error; rethrows anything else unchanged. */
export function mapDocumentDbError(err: unknown): never {
  const m = /(?:patient document|lab report): ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  const code = m[1];
  if (code === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (code === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = MESSAGES[code];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

/** Runs a database call, mapping its P6.2 refusals. */
export async function dbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapDocumentDbError(err);
  }
}

/**
 * Whether to OFFER archiving (the database decides; this only hides buttons that would fail).
 * Mirrors app.archive_patient_document without the branch check (rows the caller can see are in scope).
 */
export function canOfferArchive(
  perms: ReadonlySet<string>,
  me: { userId: string; doctorId: string | null },
  doc: { category: DocumentCategoryKey; status: string; uploadedByUserId: string; uploadedAt: Date | null },
  now = new Date()
): boolean {
  if (doc.status !== "AVAILABLE") return false;
  if (!isClinicalCategory(doc.category)) return perms.has("patient_document.manage");
  if (perms.has("lab.manage") || perms.has("medical_record.manage")) return true;
  return Boolean(me.doctorId) && doc.uploadedByUserId === me.userId && !!doc.uploadedAt && now.getTime() - doc.uploadedAt.getTime() < 24 * 3600 * 1000;
}

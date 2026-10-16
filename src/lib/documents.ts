// Patient documents and lab reports (P6.2): pure rules shared by the server and
// the browser. The SERVER is authoritative — it re-runs every check on the bytes
// it receives; the browser runs them only to give early feedback. The database
// (migration 20261021000000) re-checks type, size, checksum and filename again.

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8 MB (also the bucket's limit and a database CHECK)

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

const EXTENSIONS: Record<DocumentMimeType, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

export const CLINICAL_CATEGORIES = ["LAB_REPORT", "IMAGING", "DISCHARGE_SUMMARY", "REFERRAL", "CLINICAL_OTHER"] as const;
export const ADMIN_CATEGORIES = ["ID_PROOF", "INSURANCE", "CONSENT", "ADMIN_OTHER"] as const;
export const DOCUMENT_CATEGORIES = [...CLINICAL_CATEGORIES, ...ADMIN_CATEGORIES] as const;
export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<DocumentCategoryKey, string> = {
  LAB_REPORT: "Lab report",
  IMAGING: "Imaging",
  DISCHARGE_SUMMARY: "Discharge summary",
  REFERRAL: "Referral",
  CLINICAL_OTHER: "Other clinical",
  ID_PROOF: "ID proof",
  INSURANCE: "Insurance",
  CONSENT: "Consent form",
  ADMIN_OTHER: "Other administrative",
};

/** Mirrors app.document_is_clinical. */
export function isClinicalCategory(c: DocumentCategoryKey): boolean {
  return (CLINICAL_CATEGORIES as readonly string[]).includes(c);
}

export const ARCHIVE_REASONS = ["UPLOADED_IN_ERROR", "WRONG_PATIENT", "DUPLICATE", "ILLEGIBLE", "SUPERSEDED", "OTHER"] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];
export const ARCHIVE_REASON_LABEL: Record<ArchiveReason, string> = {
  UPLOADED_IN_ERROR: "Uploaded in error",
  WRONG_PATIENT: "Wrong patient",
  DUPLICATE: "Duplicate",
  ILLEGIBLE: "Illegible",
  SUPERSEDED: "Superseded by a newer file",
  OTHER: "Other",
};

/** Why a file was refused. Codes only — they are also the audit reason (never the filename or content). */
export type FileRejection = "empty" | "too_large" | "unsupported_type" | "type_mismatch" | "active_content" | "malformed";

export const FILE_REJECTION_MESSAGE: Record<FileRejection, string> = {
  empty: "The file is empty.",
  too_large: "The file is larger than 8 MB.",
  unsupported_type: "Only PDF, JPEG and PNG files can be uploaded.",
  type_mismatch: "The file's contents don't match its name or type.",
  active_content: "This PDF contains scripts or embedded actions and can't be uploaded. Print it to a new PDF and try again.",
  malformed: "The file looks damaged or incomplete.",
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** The type the bytes ACTUALLY are (magic numbers), or null. Never trusts names or declared types. */
export function sniffMimeType(bytes: Uint8Array): DocumentMimeType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // "%PDF-"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

// PDF features that run code or open other content. Legitimate lab reports don't
// need them; refusing is safer than serving them (malware scanning isn't available).
// Best effort only: names inside compressed object streams aren't visible here,
// which is why files are also always served with nosniff + a sandbox CSP.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData|GoToR)\b/;

function latin1(bytes: Uint8Array, from = 0, to = bytes.length): string {
  let s = "";
  for (let i = from; i < to; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, to)));
  return s;
}

export type FileCheck = { ok: true; mimeType: DocumentMimeType } | { ok: false; reason: FileRejection };

/**
 * Validates an upload from its bytes: size, real type (magic bytes), agreement
 * with the declared type and the filename's extension, basic structure, and —
 * for PDFs — no active content. HTML, SVG, executables etc. fail the sniff.
 */
export function checkDocumentBytes(bytes: Uint8Array, declaredType: string | null | undefined, filename: string): FileCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large" };
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) return { ok: false, reason: "unsupported_type" };
  const declared = (declaredType ?? "").trim().toLowerCase();
  const normalisedDeclared = declared === "image/jpg" || declared === "image/pjpeg" ? "image/jpeg" : declared;
  if (normalisedDeclared && normalisedDeclared !== "application/octet-stream" && normalisedDeclared !== sniffed) return { ok: false, reason: "type_mismatch" };
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim())?.[1]?.toLowerCase();
  if (!ext || !EXTENSIONS[sniffed].includes(ext)) return { ok: false, reason: "type_mismatch" };

  if (sniffed === "application/pdf") {
    const tail = latin1(bytes, Math.max(0, bytes.length - 2048));
    if (!tail.includes("%%EOF")) return { ok: false, reason: "malformed" };
    if (PDF_ACTIVE.test(latin1(bytes))) return { ok: false, reason: "active_content" };
  } else if (sniffed === "image/png") {
    // The first chunk must be IHDR (bytes 12..15).
    if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return { ok: false, reason: "malformed" };
  } else if (bytes.length < 4) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, mimeType: sniffed };
}

/**
 * A safe display name (never a path): last path segment only, Unicode-normalised,
 * control and separator characters removed, whitespace collapsed, at most 200
 * characters, with the extension of the type the bytes actually are.
 */
export function sanitizeFilename(name: string, mimeType: DocumentMimeType): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  let base = last.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  base = base.replace(/\.[A-Za-z0-9]{1,8}$/, ""); // drop the claimed extension; ours replaces it
  base = base.replace(/[^\p{L}\p{M}\p{N} ._()\-+,&]/gu, "_").replace(/\s+/g, " ").replace(/^[.\s_]+|[.\s_]+$/g, "");
  const ext = EXTENSIONS[mimeType][0];
  if (!base) base = "document";
  return `${base.slice(0, 200 - ext.length - 1)}.${ext}`;
}

/** An ASCII-only fallback for the Content-Disposition `filename=` parameter. */
export function asciiFilename(name: string): string {
  return name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\;]/g, "_").trim() || "document";
}

// --- Lab reports ---------------------------------------------------------------

export const LAB_FLAGS = ["low", "high", "normal", "abnormal"] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

export interface LabValue {
  parameter: string;
  value?: string | null;
  unit?: string | null;
  range?: string | null;
  flag?: LabFlag | null;
}

export const LAB_REPORT_STATUS_LABEL = { PENDING: "Pending", AVAILABLE: "Available", REVIEWED: "Reviewed" } as const;
export type LabReportStatusKey = keyof typeof LAB_REPORT_STATUS_LABEL;

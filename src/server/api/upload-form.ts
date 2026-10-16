import "server-only";
import type { NextRequest } from "next/server";
import { DataError } from "@/server/api/errors";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";
import type { IncomingFile } from "@/server/data/documents";

// Reads one multipart upload. Bodies over the limit are refused BEFORE they are
// read (Next's proxy buffers only about 10 MB and silently truncates the rest, so
// a truncated multipart body fails to parse here and is rejected; it can never
// become a stored file). The file's name and type are untrusted hints: the
// bytes are validated by checkDocumentBytes in the data layer.

const MULTIPART_OVERHEAD = 64 * 1024;
const FIELDS = ["category", "title", "branchId", "labReportId", "consultationId", "testType"] as const;

export async function readUploadForm(request: NextRequest): Promise<{ file: IncomingFile; fields: Record<string, string> }> {
  if (!/^multipart\/form-data;/i.test(request.headers.get("content-type") ?? "")) {
    throw new DataError("INVALID_INPUT", "Send the file as multipart/form-data.");
  }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) throw new DataError("INVALID_INPUT", "The upload has no Content-Length.");
  if (length > MAX_DOCUMENT_BYTES + MULTIPART_OVERHEAD) throw new DataError("FILE_TOO_LARGE", "The file is larger than 8 MB.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new DataError("INVALID_INPUT", "The upload was incomplete. Please try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new DataError("INVALID_INPUT", "Choose a file to upload.");
  if (file.size > MAX_DOCUMENT_BYTES) throw new DataError("FILE_TOO_LARGE", "The file is larger than 8 MB.");
  const fields: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = form.get(key);
    if (typeof v === "string" && v.trim() !== "") fields[key] = v;
  }
  return { file: { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name.slice(0, 1000), type: file.type }, fields };
}

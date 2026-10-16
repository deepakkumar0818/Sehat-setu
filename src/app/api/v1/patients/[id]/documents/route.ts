import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { readUploadForm } from "@/server/api/upload-form";
import { listDocuments, uploadDocument } from "@/server/data/documents";
import { DOCUMENT_READ, DOCUMENT_UPLOAD } from "@/server/data/document-rules";

// A patient's documents (RLS decides which ones the caller sees).
export const GET = apiRoute<{ id: string }>({ permission: [...DOCUMENT_READ, ...DOCUMENT_UPLOAD], resource: "GET /api/v1/patients/[id]/documents" }, ({ ctx, request, params }) =>
  listDocuments(ctx, { ...searchParamsOf(request), patientId: params.id })
);

/** multipart/form-data: file + category, title, optional branchId / labReportId / consultationId / testType. */
export const POST = apiRoute<{ id: string }>({ permission: DOCUMENT_UPLOAD, resource: "POST /api/v1/patients/[id]/documents" }, async ({ ctx, request, params }) => {
  const { file, fields } = await readUploadForm(request);
  return uploadDocument(ctx, params.id, file, fields);
});

import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { listDocuments } from "@/server/data/documents";
import { DOCUMENT_READ, DOCUMENT_UPLOAD } from "@/server/data/document-rules";

export const GET = apiRoute({ permission: [...DOCUMENT_READ, ...DOCUMENT_UPLOAD], resource: "GET /api/v1/documents" }, ({ ctx, request }) =>
  listDocuments(ctx, searchParamsOf(request))
);

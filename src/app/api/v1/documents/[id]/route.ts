import { apiRoute } from "@/server/api/route-handler";
import { getDocument } from "@/server/data/documents";
import { DOCUMENT_READ, DOCUMENT_UPLOAD } from "@/server/data/document-rules";

export const GET = apiRoute<{ id: string }>({ permission: [...DOCUMENT_READ, ...DOCUMENT_UPLOAD], resource: "GET /api/v1/documents/[id]" }, ({ ctx, params }) =>
  getDocument(ctx, params.id)
);

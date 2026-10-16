import { apiRoute } from "@/server/api/route-handler";
import { archiveDocument } from "@/server/data/documents";
import { DOCUMENT_ARCHIVE } from "@/server/data/document-rules";

/** Body { reason, note? }. Archive only: documents are never deleted. */
export const POST = apiRoute<{ id: string }>({ permission: DOCUMENT_ARCHIVE, resource: "POST /api/v1/documents/[id]/archive" }, async ({ ctx, request, params }) =>
  archiveDocument(ctx, params.id, await request.json())
);

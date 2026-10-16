import { fileRoute } from "@/server/api/route-handler";
import { openDocumentFile } from "@/server/data/documents";
import { DOCUMENT_READ } from "@/server/data/document-rules";

// The file itself, after RLS authorized the row and the view was audited (see openDocumentFile).
// ?disposition=inline shows an image in the browser; PDFs are always downloaded.
export const GET = fileRoute<{ id: string }>({ permission: DOCUMENT_READ, resource: "GET /api/v1/documents/[id]/file" }, async ({ ctx, request, params }) => {
  const requested = request.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
  const file = await openDocumentFile(ctx, params.id, requested);
  return { filename: file.filename, contentType: file.mimeType, body: file.bytes, disposition: file.disposition };
});

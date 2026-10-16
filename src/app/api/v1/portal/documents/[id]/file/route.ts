import { patientFileRoute } from "@/server/api/route-handler";
import { openPatientDocumentFile } from "@/server/data/documents";

// The file itself, after the patient's own transaction authorized the row and the view was audited.
// ?disposition=inline shows an image in the browser; PDFs are always downloaded.
export const GET = patientFileRoute<{ id: string }>({ resource: "GET /api/v1/portal/documents/[id]/file" }, async ({ ctx, request, params }) => {
  const requested = request.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
  const file = await openPatientDocumentFile(ctx, params.id, requested);
  return { filename: file.filename, contentType: file.mimeType, body: file.bytes, disposition: file.disposition };
});

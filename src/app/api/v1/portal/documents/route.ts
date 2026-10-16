import { patientRoute, searchParamsOf } from "@/server/api/route-handler";
import { listMyDocuments } from "@/server/data/portal";

// Result files of the patient's own shared reports (the only documents patients may open).
export const GET = patientRoute({ resource: "GET /api/v1/portal/documents" }, ({ ctx, request }) => listMyDocuments(ctx, searchParamsOf(request)));

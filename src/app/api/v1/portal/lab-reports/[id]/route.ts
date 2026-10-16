import { patientRoute } from "@/server/api/route-handler";
import { getMyLabReport } from "@/server/data/portal";

// One of the patient's own shared reports; anything else is the same 404. Views are audited.
export const GET = patientRoute<{ id: string }>({ resource: "GET /api/v1/portal/lab-reports/[id]" }, ({ ctx, params }) => getMyLabReport(ctx, params.id));

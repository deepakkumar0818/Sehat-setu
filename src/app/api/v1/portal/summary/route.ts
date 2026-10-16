import { patientRoute } from "@/server/api/route-handler";
import { getPortalSummary } from "@/server/data/portal";

// Patient portal home: the signed-in patient's own record name and their shared-report counts.
export const GET = patientRoute({ resource: "GET /api/v1/portal/summary" }, ({ ctx }) => getPortalSummary(ctx));

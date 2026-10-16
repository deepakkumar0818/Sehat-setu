import { patientRoute, searchParamsOf } from "@/server/api/route-handler";
import { listMyLabReports } from "@/server/data/portal";

// The signed-in patient's reviewed, shared lab reports (no patient id is accepted from the request).
export const GET = patientRoute({ resource: "GET /api/v1/portal/lab-reports" }, ({ ctx, request }) => listMyLabReports(ctx, searchParamsOf(request)));

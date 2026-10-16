import { patientRoute } from "@/server/api/route-handler";
import { getPortalDashboard } from "@/server/data/portal-booking";

// Patient portal home: the signed-in patient's own profile summary, appointments, open invoices and shared-record counts.
export const GET = patientRoute({ resource: "GET /api/v1/portal/dashboard" }, ({ ctx }) => getPortalDashboard(ctx));

import { apiRoute } from "@/server/api/route-handler";
import { listSpecialtyUsage } from "@/server/data/clinic-setup";

/** The specialty catalogue with how many of this clinic's doctors and departments use each. */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/specialties/usage" }, ({ ctx }) => listSpecialtyUsage(ctx));

import { apiRoute } from "@/server/api/route-handler";
import { listSpecialties } from "@/server/data/specialties";

/** Specialty catalogue (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/specialties" }, ({ ctx }) => listSpecialties(ctx));

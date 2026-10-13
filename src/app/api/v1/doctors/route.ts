import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { listDoctors, listDoctorsSchema } from "@/server/data/people";

/** Doctor directory of the caller's clinic (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/doctors" }, ({ ctx, request }) =>
  listDoctors(ctx, listDoctorsSchema.parse(searchParamsOf(request)))
);

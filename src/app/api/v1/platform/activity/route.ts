import { platformRoute, searchParamsOf } from "@/server/api/route-handler";
import { getPlatformActivity } from "@/server/data/platform";

/** Platform actions and refusals/failures anywhere: ?clinicId=&kind=all|platform|problems&before= */
export const GET = platformRoute({ resource: "GET /api/v1/platform/activity" }, ({ identity, request }) => getPlatformActivity(identity, searchParamsOf(request)));

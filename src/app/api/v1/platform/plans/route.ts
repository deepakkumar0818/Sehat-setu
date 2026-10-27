import { platformRoute } from "@/server/api/route-handler";
import { listPlatformPlans, savePlatformPlan } from "@/server/data/platform";

/** The plans clinics can be on, with how many clinics are on each. */
export const GET = platformRoute({ resource: "GET /api/v1/platform/plans" }, ({ identity }) => listPlatformPlans(identity));

/** A new plan. */
export const POST = platformRoute({ resource: "POST /api/v1/platform/plans" }, async ({ identity, request }) => savePlatformPlan(identity, null, await request.json()));

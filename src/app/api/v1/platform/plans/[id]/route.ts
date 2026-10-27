import { platformRoute } from "@/server/api/route-handler";
import { savePlatformPlan } from "@/server/data/platform";

/** Change a plan's name, prices, limits or availability. */
export const PUT = platformRoute<{ id: string }>({ resource: "PUT /api/v1/platform/plans/[id]" }, async ({ identity, params, request }) =>
  savePlatformPlan(identity, params.id, await request.json())
);

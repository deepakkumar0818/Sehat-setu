import { platformRoute } from "@/server/api/route-handler";
import { setPlatformSubscription } from "@/server/data/platform";

/** The clinic's plan, billing cycle, agreed price, paid-until date and auto-suspend. */
export const PUT = platformRoute<{ id: string }>({ resource: "PUT /api/v1/platform/clinics/[id]/subscription" }, async ({ identity, params, request }) =>
  setPlatformSubscription(identity, params.id, await request.json())
);

import { apiRoute } from "@/server/api/route-handler";
import { INVENTORY_MANAGE, reverseMovement } from "@/server/data/inventory";

/** Reverse a receipt or adjustment, once. */
export const POST = apiRoute<{ id: string }>({ permission: INVENTORY_MANAGE, resource: "POST /api/v1/inventory/movements/[id]/reverse" }, async ({ ctx, params, request }) =>
  reverseMovement(ctx, params.id, await request.json())
);

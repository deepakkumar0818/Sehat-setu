import { apiRoute } from "@/server/api/route-handler";
import { adjustStock, INVENTORY_MANAGE } from "@/server/data/inventory";

/** Signed stock adjustment with a reason: { quantityDelta, reason }. */
export const POST = apiRoute<{ id: string }>({ permission: INVENTORY_MANAGE, resource: "POST /api/v1/inventory/items/[id]/adjustments" }, async ({ ctx, params, request }) =>
  adjustStock(ctx, params.id, await request.json())
);

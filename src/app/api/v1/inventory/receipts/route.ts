import { apiRoute } from "@/server/api/route-handler";
import { INVENTORY_MANAGE, receiveStock } from "@/server/data/inventory";

/** Receive stock into a (new or existing) batch. */
export const POST = apiRoute({ permission: INVENTORY_MANAGE, resource: "POST /api/v1/inventory/receipts" }, async ({ ctx, request }) =>
  receiveStock(ctx, await request.json())
);

import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { INVENTORY_VIEW, listStock, listStockSchema } from "@/server/data/inventory";

/** Stock overview: one row per medicine per branch. */
export const GET = apiRoute({ permission: INVENTORY_VIEW, resource: "GET /api/v1/inventory" }, ({ ctx, request }) =>
  listStock(ctx, listStockSchema.parse(searchParamsOf(request)))
);

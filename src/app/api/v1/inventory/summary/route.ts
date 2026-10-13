import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { getInventorySummary, INVENTORY_VIEW } from "@/server/data/inventory";

export const GET = apiRoute({ permission: INVENTORY_VIEW, resource: "GET /api/v1/inventory/summary" }, ({ ctx, request }) =>
  getInventorySummary(ctx, searchParamsOf(request).branchId || undefined)
);

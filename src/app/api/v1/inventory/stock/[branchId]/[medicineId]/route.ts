import { apiRoute } from "@/server/api/route-handler";
import { getStockDetail, INVENTORY_VIEW } from "@/server/data/inventory";

/** One medicine at one branch: batches, reorder level and movement history. */
export const GET = apiRoute<{ branchId: string; medicineId: string }>(
  { permission: INVENTORY_VIEW, resource: "GET /api/v1/inventory/stock/[branchId]/[medicineId]" },
  ({ ctx, params }) => getStockDetail(ctx, params.branchId, params.medicineId)
);

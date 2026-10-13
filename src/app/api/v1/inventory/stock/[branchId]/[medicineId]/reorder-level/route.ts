import { apiRoute } from "@/server/api/route-handler";
import { INVENTORY_MANAGE, setReorderLevel } from "@/server/data/inventory";

export const PUT = apiRoute<{ branchId: string; medicineId: string }>(
  { permission: INVENTORY_MANAGE, resource: "PUT /api/v1/inventory/stock/[branchId]/[medicineId]/reorder-level" },
  async ({ ctx, params, request }) => setReorderLevel(ctx, params.branchId, params.medicineId, await request.json())
);

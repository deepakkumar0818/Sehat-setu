import { apiRoute } from "@/server/api/route-handler";
import { BRANCH_UPDATE, updateBranch } from "@/server/data/clinic-setup";

/** Edit a branch's details, or { status } to deactivate/reactivate it (branch.update). */
export const PATCH = apiRoute<{ id: string }>({ permission: BRANCH_UPDATE, resource: "PATCH /api/v1/branches/[id]" }, async ({ ctx, params, request }) =>
  updateBranch(ctx, params.id, await request.json())
);

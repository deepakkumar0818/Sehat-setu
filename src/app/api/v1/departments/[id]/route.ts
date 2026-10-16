import { apiRoute } from "@/server/api/route-handler";
import { DEPARTMENT_MANAGE, updateDepartment } from "@/server/data/clinic-setup";

/** Edit a department, or { status } to deactivate/reactivate it. */
export const PATCH = apiRoute<{ id: string }>({ permission: DEPARTMENT_MANAGE, resource: "PATCH /api/v1/departments/[id]" }, async ({ ctx, params, request }) =>
  updateDepartment(ctx, params.id, await request.json())
);

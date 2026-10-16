import { apiRoute } from "@/server/api/route-handler";
import { createDepartment, DEPARTMENT_MANAGE, listDepartments } from "@/server/data/clinic-setup";

/** Departments of the caller's clinic (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/departments" }, ({ ctx }) => listDepartments(ctx));

/** Add a department, clinic-wide or at one branch. */
export const POST = apiRoute({ permission: DEPARTMENT_MANAGE, resource: "POST /api/v1/departments" }, async ({ ctx, request }) =>
  createDepartment(ctx, await request.json())
);

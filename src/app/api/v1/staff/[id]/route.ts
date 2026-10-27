import { apiRoute } from "@/server/api/route-handler";
import { removeStaffMember, STAFF_REMOVE, updateStaffMember } from "@/server/data/people";

/**
 * Update a staff membership: { status: "active" | "inactive" } (Administrators
 * and Clinic Managers), { phone } alone, or details — any of { name, phone,
 * branchId } (Administrators only — checked again in the data layer and in
 * app.set_staff_name / app.set_staff_phone).
 */
export const PATCH = apiRoute<{ id: string }>(
  { permission: ["staff.manage", "user.disable", "user.update"], resource: "PATCH /api/v1/staff/[id]" },
  async ({ ctx, params, request }) => updateStaffMember(ctx, params.id, await request.json())
);

/** Delete a staff member from the clinic (Administrators; never yourself or the last active administrator). */
export const DELETE = apiRoute<{ id: string }>({ permission: STAFF_REMOVE, resource: "DELETE /api/v1/staff/[id]" }, ({ ctx, params }) =>
  removeStaffMember(ctx, params.id)
);

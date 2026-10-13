import { apiRoute } from "@/server/api/route-handler";
import { updateStaffMember } from "@/server/data/people";

/**
 * Update a staff membership: { status: "active" | "inactive" } (Administrators
 * and Clinic Managers) or { phone } (Administrators only — checked again in the
 * data layer and in app.set_staff_phone).
 */
export const PATCH = apiRoute<{ id: string }>(
  { permission: ["staff.manage", "user.disable"], resource: "PATCH /api/v1/staff/[id]" },
  async ({ ctx, params, request }) => updateStaffMember(ctx, params.id, await request.json())
);

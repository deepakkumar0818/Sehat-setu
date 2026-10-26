import { apiRoute } from "@/server/api/route-handler";
import { MEMBER_ACCESS_MANAGE, updateMemberAccess } from "@/server/data/clinic-users";

/** Change a staff member's role ({ role }) or their permission changes ({ granted, revoked }). Administrators only. */
export const PATCH = apiRoute<{ id: string }>({ permission: MEMBER_ACCESS_MANAGE, resource: "PATCH /api/v1/clinic-users/[id]" }, async ({ ctx, params, request }) =>
  updateMemberAccess(ctx, params.id, await request.json())
);

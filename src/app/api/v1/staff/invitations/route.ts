import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { INVITATION_MANAGE, INVITATION_VIEW } from "@/server/data/people";
import { createInvitation, listInvitations } from "@/server/data/invitations";

/** Invitations of the caller's clinic within their branch scope (Administrators; Clinic Managers read-only). */
export const GET = apiRoute({ permission: INVITATION_VIEW, resource: "GET /api/v1/staff/invitations" }, ({ ctx, request }) =>
  listInvitations(ctx, searchParamsOf(request))
);

/** Invite a Doctor, Clinic Manager, Receptionist or Nurse (Administrators only). */
export const POST = apiRoute({ permission: INVITATION_MANAGE, resource: "POST /api/v1/staff/invitations" }, async ({ ctx, request }) =>
  createInvitation(ctx, await request.json())
);

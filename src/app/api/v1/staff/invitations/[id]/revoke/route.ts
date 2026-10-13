import { apiRoute } from "@/server/api/route-handler";
import { INVITATION_MANAGE } from "@/server/data/people";
import { revokeInvitation } from "@/server/data/invitations";

export const POST = apiRoute<{ id: string }>({ permission: INVITATION_MANAGE, resource: "POST /api/v1/staff/invitations/[id]/revoke" }, ({ ctx, params }) =>
  revokeInvitation(ctx, params.id)
);

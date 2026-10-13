import { apiRoute } from "@/server/api/route-handler";
import { INVITATION_MANAGE } from "@/server/data/people";
import { resendInvitation } from "@/server/data/invitations";

export const POST = apiRoute<{ id: string }>({ permission: INVITATION_MANAGE, resource: "POST /api/v1/staff/invitations/[id]/resend" }, ({ ctx, params }) =>
  resendInvitation(ctx, params.id)
);

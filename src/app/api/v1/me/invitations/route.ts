import { identityRoute } from "@/server/api/route-handler";
import { listMyInvitations } from "@/server/data/invitations";

/** The signed-in user's own pending staff invitations (they may not belong to any clinic yet). */
export const GET = identityRoute({ resource: "GET /api/v1/me/invitations" }, ({ identity }) => listMyInvitations(identity));

import { apiRoute } from "@/server/api/route-handler";
import { getPortalLinkStatus, issuePortalLinkCode } from "@/server/data/patient-link";
import { PORTAL_LINK_PERMISSION } from "@/server/data/patient-link-rules";

/** Whether this patient has a portal account linked, and their usable code's issue/expiry times (never the code). */
export const GET = apiRoute<{ id: string }>({ permission: PORTAL_LINK_PERMISSION, resource: "GET /api/v1/patients/[id]/portal-link" }, ({ ctx, params }) =>
  getPortalLinkStatus(ctx, params.id)
);

/** Issues a one-time linking code after the clinic's identity check (body: { identityVerified: true }). The code is in this response only. */
export const POST = apiRoute<{ id: string }>({ permission: PORTAL_LINK_PERMISSION, resource: "POST /api/v1/patients/[id]/portal-link" }, async ({ ctx, request, params }) =>
  issuePortalLinkCode(ctx, params.id, await request.json())
);

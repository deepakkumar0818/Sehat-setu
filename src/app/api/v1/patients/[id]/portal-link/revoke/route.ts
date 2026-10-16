import { apiRoute } from "@/server/api/route-handler";
import { revokePortalLinkCode } from "@/server/data/patient-link";
import { PORTAL_LINK_PERMISSION } from "@/server/data/patient-link-rules";

/** Revokes this patient's usable linking code, if any. */
export const POST = apiRoute<{ id: string }>({ permission: PORTAL_LINK_PERMISSION, resource: "POST /api/v1/patients/[id]/portal-link/revoke" }, ({ ctx, params }) =>
  revokePortalLinkCode(ctx, params.id)
);

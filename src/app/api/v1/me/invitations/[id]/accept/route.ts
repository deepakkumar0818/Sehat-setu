import { cookies } from "next/headers";
import { identityRoute } from "@/server/api/route-handler";
import { ACTIVE_CLINIC_COOKIE } from "@/server/auth/session";
import { acceptInvitation } from "@/server/data/invitations";

/** Explicitly accept one of your own invitations; the membership comes from the stored invitation only. */
export const POST = identityRoute<{ id: string }>({ resource: "POST /api/v1/me/invitations/[id]/accept" }, async ({ identity, params }) => {
  const result = await acceptInvitation(identity, params.id);
  // Open the clinic just joined (a preference only — always re-validated against memberships).
  (await cookies()).set(ACTIVE_CLINIC_COOKIE, result.clinicId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return result;
});

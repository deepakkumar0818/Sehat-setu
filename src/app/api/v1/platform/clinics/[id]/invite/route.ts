import { platformRoute } from "@/server/api/route-handler";
import { resendClinicAdminInvite } from "@/server/data/platform";

/** Resend the sign-in invitation to one of the clinic's administrators who hasn't signed in yet: { email }. */
export const POST = platformRoute<{ id: string }>({ resource: "POST /api/v1/platform/clinics/[id]/invite" }, async ({ identity, params, request }) =>
  resendClinicAdminInvite(identity, params.id, await request.json())
);

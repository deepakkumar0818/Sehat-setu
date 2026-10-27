import { platformRoute } from "@/server/api/route-handler";
import { addPlatformClinicAdmin } from "@/server/data/platform";

/** Make someone an administrator of the clinic: { name, email }. */
export const POST = platformRoute<{ id: string }>({ resource: "POST /api/v1/platform/clinics/[id]/admins" }, async ({ identity, params, request }) =>
  addPlatformClinicAdmin(identity, params.id, await request.json())
);

import { platformRoute } from "@/server/api/route-handler";
import { removePlatformClinicAdmin } from "@/server/data/platform";

/** Take the administrator role away (never from the clinic's last administrator). */
export const DELETE = platformRoute<{ id: string; userId: string }>({ resource: "DELETE /api/v1/platform/clinics/[id]/admins/[userId]" }, ({ identity, params }) =>
  removePlatformClinicAdmin(identity, params.id, params.userId)
);

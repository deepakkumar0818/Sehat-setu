import { platformRoute } from "@/server/api/route-handler";
import { updatePlatformClinic } from "@/server/data/platform";

/** The clinic's name, contact details and address (not its code). */
export const PUT = platformRoute<{ id: string }>({ resource: "PUT /api/v1/platform/clinics/[id]/profile" }, async ({ identity, params, request }) =>
  updatePlatformClinic(identity, params.id, await request.json())
);

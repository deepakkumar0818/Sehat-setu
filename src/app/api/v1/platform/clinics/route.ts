import { platformRoute } from "@/server/api/route-handler";
import { createPlatformClinic, getPlatformOverview } from "@/server/data/platform";

/** Every clinic on Sehat Setu with usage counts (super admins only). */
export const GET = platformRoute({ resource: "GET /api/v1/platform/clinics" }, ({ identity }) => getPlatformOverview(identity));

/** Add a clinic with its head-office branch and first administrator, who is emailed an invitation. */
export const POST = platformRoute({ resource: "POST /api/v1/platform/clinics" }, async ({ identity, request }) => createPlatformClinic(identity, await request.json()));

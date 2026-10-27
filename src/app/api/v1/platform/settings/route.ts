import { platformRoute } from "@/server/api/route-handler";
import { getPlatformSettings } from "@/server/data/platform";

/** Super admins, and whether invitation emails can be sent. */
export const GET = platformRoute({ resource: "GET /api/v1/platform/settings" }, ({ identity }) => getPlatformSettings(identity));

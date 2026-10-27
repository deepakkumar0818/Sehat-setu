import { platformRoute } from "@/server/api/route-handler";
import { getPlatformPaymentTotals } from "@/server/data/platform";

/** Money received from clinics per month, the last 12 months. */
export const GET = platformRoute({ resource: "GET /api/v1/platform/payments/totals" }, ({ identity }) => getPlatformPaymentTotals(identity));

import { platformRoute, searchParamsOf } from "@/server/api/route-handler";
import { getPlatformPayments } from "@/server/data/platform";

/** Every clinic's payments to Sehat Setu, newest first: ?clinicId=&before= */
export const GET = platformRoute({ resource: "GET /api/v1/platform/payments" }, ({ identity, request }) => getPlatformPayments(identity, searchParamsOf(request)));

import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { listNotifications } from "@/server/data/notifications";

/** The signed-in staff member's notifications (any active staff member; RLS decides visibility). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/notifications" }, ({ ctx, request }) => listNotifications(ctx, searchParamsOf(request)));

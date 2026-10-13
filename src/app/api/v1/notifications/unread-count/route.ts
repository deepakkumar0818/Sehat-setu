import { apiRoute } from "@/server/api/route-handler";
import { unreadCount } from "@/server/data/notifications";

export const GET = apiRoute({ permission: [], resource: "GET /api/v1/notifications/unread-count" }, ({ ctx }) => unreadCount(ctx));

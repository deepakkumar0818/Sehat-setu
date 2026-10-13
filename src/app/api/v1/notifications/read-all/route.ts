import { apiRoute } from "@/server/api/route-handler";
import { markAllNotificationsRead } from "@/server/data/notifications";

/** Body: { before } — the time the client last fetched; newer notifications stay unread. */
export const POST = apiRoute({ permission: [], resource: "POST /api/v1/notifications/read-all" }, async ({ ctx, request }) =>
  markAllNotificationsRead(ctx, await request.json())
);

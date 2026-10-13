import { apiRoute } from "@/server/api/route-handler";
import { markNotificationRead } from "@/server/data/notifications";

export const POST = apiRoute<{ id: string }>({ permission: [], resource: "POST /api/v1/notifications/[id]/read" }, ({ ctx, params }) =>
  markNotificationRead(ctx, params.id)
);

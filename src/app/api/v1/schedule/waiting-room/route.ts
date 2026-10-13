import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { APPOINTMENT_VIEW, getWaitingRoom } from "@/server/data/appointments";

export const GET = apiRoute({ permission: APPOINTMENT_VIEW, resource: "GET /api/v1/schedule/waiting-room" }, ({ ctx, request }) =>
  getWaitingRoom(ctx, searchParamsOf(request).branchId || undefined)
);

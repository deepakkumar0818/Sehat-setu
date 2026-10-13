import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { APPOINTMENT_VIEW, getTodaysAppointments } from "@/server/data/appointments";

export const GET = apiRoute({ permission: APPOINTMENT_VIEW, resource: "GET /api/v1/schedule/today" }, ({ ctx, request }) =>
  getTodaysAppointments(ctx, searchParamsOf(request).branchId || undefined)
);

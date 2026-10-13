import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { APPOINTMENT_VIEW, createAppointment, listAppointments, listAppointmentsSchema } from "@/server/data/appointments";

export const GET = apiRoute({ permission: APPOINTMENT_VIEW, resource: "GET /api/v1/appointments" }, ({ ctx, request }) =>
  listAppointments(ctx, listAppointmentsSchema.parse(searchParamsOf(request)))
);

export const POST = apiRoute({ permission: "appointment.create", resource: "POST /api/v1/appointments" }, async ({ ctx, request }) =>
  createAppointment(ctx, await request.json())
);

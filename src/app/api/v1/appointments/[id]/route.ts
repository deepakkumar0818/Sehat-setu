import { apiRoute } from "@/server/api/route-handler";
import { APPOINTMENT_VIEW, getAppointment, rescheduleAppointment } from "@/server/data/appointments";

export const GET = apiRoute<{ id: string }>({ permission: APPOINTMENT_VIEW, resource: "GET /api/v1/appointments/[id]" }, ({ ctx, params }) =>
  getAppointment(ctx, params.id)
);

/** Reschedule: { date, time }. */
export const PATCH = apiRoute<{ id: string }>(
  { permission: ["appointment.update", "own_appointments.manage"], resource: "PATCH /api/v1/appointments/[id]" },
  async ({ ctx, params, request }) => rescheduleAppointment(ctx, params.id, await request.json())
);

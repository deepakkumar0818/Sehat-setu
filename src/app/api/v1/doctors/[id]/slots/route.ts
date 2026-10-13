import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { getAvailableSlots } from "@/server/data/appointments";

/** Free slots on ?date=yyyy-MM-dd — for people who can book or move appointments. */
export const GET = apiRoute<{ id: string }>(
  { permission: ["appointment.create", "appointment.update", "own_appointments.manage"], resource: "GET /api/v1/doctors/[id]/slots" },
  ({ ctx, params, request }) => getAvailableSlots(ctx, params.id, searchParamsOf(request).date ?? "")
);

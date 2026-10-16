import { patientRoute } from "@/server/api/route-handler";
import { rescheduleMyAppointment } from "@/server/data/portal-booking";

// Moves one of the patient's own appointments to another free slot with the same doctor and branch.
export const POST = patientRoute<{ id: string }>({ resource: "POST /api/v1/portal/appointments/[id]/reschedule" }, async ({ ctx, params, request }) =>
  rescheduleMyAppointment(ctx, params.id, await request.json())
);

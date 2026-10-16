import { patientRoute } from "@/server/api/route-handler";
import { cancelMyAppointment } from "@/server/data/portal-booking";

// Cancels one of the patient's own appointments that hasn't started (the database re-checks).
export const POST = patientRoute<{ id: string }>({ resource: "POST /api/v1/portal/appointments/[id]/cancel" }, ({ ctx, params }) => cancelMyAppointment(ctx, params.id));

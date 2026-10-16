import { patientRoute } from "@/server/api/route-handler";
import { getMyAppointment } from "@/server/data/portal-booking";

// One of the patient's own appointments; anyone else's is the same 404.
export const GET = patientRoute<{ id: string }>({ resource: "GET /api/v1/portal/appointments/[id]" }, ({ ctx, params }) => getMyAppointment(ctx, params.id));

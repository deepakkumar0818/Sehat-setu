import { patientRoute, searchParamsOf } from "@/server/api/route-handler";
import { bookMyAppointment, listMyAppointments } from "@/server/data/portal-booking";

// The signed-in patient's own appointments, and booking a new one. No patient id is accepted from the request.
export const GET = patientRoute({ resource: "GET /api/v1/portal/appointments" }, ({ ctx, request }) => listMyAppointments(ctx, searchParamsOf(request)));

export const POST = patientRoute({ resource: "POST /api/v1/portal/appointments" }, async ({ ctx, request }) => bookMyAppointment(ctx, await request.json()));

import { patientRoute, searchParamsOf } from "@/server/api/route-handler";
import { getMySlots } from "@/server/data/portal-booking";

// Free slots for a doctor at a branch on a date (times only). A hint: booking re-checks under a lock.
export const GET = patientRoute({ resource: "GET /api/v1/portal/slots" }, ({ ctx, request }) => getMySlots(ctx, searchParamsOf(request)));

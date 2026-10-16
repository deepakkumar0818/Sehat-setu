import { patientRoute } from "@/server/api/route-handler";
import { getBookingOptions } from "@/server/data/portal-booking";

// Branches and doctors of the patient's own clinic that accept bookings.
export const GET = patientRoute({ resource: "GET /api/v1/portal/booking-options" }, ({ ctx }) => getBookingOptions(ctx));

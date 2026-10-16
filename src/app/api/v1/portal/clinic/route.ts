import { patientRoute } from "@/server/api/route-handler";
import { getMyClinicContact } from "@/server/data/portal-booking";

// The signed-in patient's own clinic: name and public contact details only.
export const GET = patientRoute({ resource: "GET /api/v1/portal/clinic" }, ({ ctx }) => getMyClinicContact(ctx));

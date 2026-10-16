import { patientRoute } from "@/server/api/route-handler";
import { getMyClinicRecord } from "@/server/data/portal-booking";

// The clinic's record of the patient, as staff keep it (read-only).
export const GET = patientRoute({ resource: "GET /api/v1/portal/record" }, ({ ctx }) => getMyClinicRecord(ctx));

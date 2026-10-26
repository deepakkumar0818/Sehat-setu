import { apiRoute } from "@/server/api/route-handler";
import { CLINIC_USERS_VIEW, listClinicUsers } from "@/server/data/clinic-users";

/** Everyone with a staff role in the caller's clinic, doctors included (Users & Roles). */
export const GET = apiRoute({ permission: CLINIC_USERS_VIEW, resource: "GET /api/v1/clinic-users" }, ({ ctx }) => listClinicUsers(ctx));

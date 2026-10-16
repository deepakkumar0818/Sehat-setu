import { apiRoute } from "@/server/api/route-handler";
import { CLINIC_EDIT, getClinicProfile, updateClinicProfile } from "@/server/data/clinic-setup";

/** The caller's clinic profile and usage counts. */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/clinic" }, ({ ctx }) => getClinicProfile(ctx));

/** Edit the clinic profile (clinic.update / clinic.settings.manage). */
export const PATCH = apiRoute({ permission: CLINIC_EDIT, resource: "PATCH /api/v1/clinic" }, async ({ ctx, request }) => updateClinicProfile(ctx, await request.json()));

import { apiRoute } from "@/server/api/route-handler";
import { getClinicSettings, SETTINGS_MANAGE, updateClinicSettings } from "@/server/data/clinic-settings";

/** The clinic's settings: timings, online booking, billing and branding (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/clinic/settings" }, ({ ctx }) => getClinicSettings(ctx));

/** Change some of them (clinic-wide administrators, clinic.settings.manage). */
export const PATCH = apiRoute({ permission: SETTINGS_MANAGE, resource: "PATCH /api/v1/clinic/settings" }, async ({ ctx, request }) => updateClinicSettings(ctx, await request.json()));

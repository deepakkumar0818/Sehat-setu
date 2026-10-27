import { apiRoute } from "@/server/api/route-handler";
import { getMyProfile, updateMyProfile } from "@/server/data/people";

/** Your own details in this clinic (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/me/profile" }, ({ ctx }) => getMyProfile(ctx));

/** Edit your own name and/or phone: { name?, phone? } (Administrators; checked again in the data layer and the database). */
export const PATCH = apiRoute({ permission: ["user.update"], resource: "PATCH /api/v1/me/profile" }, async ({ ctx, request }) => updateMyProfile(ctx, await request.json()));

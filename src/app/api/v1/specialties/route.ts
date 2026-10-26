import { apiRoute } from "@/server/api/route-handler";
import { listSpecialties } from "@/server/data/specialties";
import { createSpecialty, SPECIALTY_MANAGE } from "@/server/data/clinic-setup";

/** Specialties this clinic can use: the shared catalogue and its own (any active staff member). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/specialties" }, ({ ctx }) => listSpecialties(ctx));

/** Add one of the clinic's own specialties (administrators). */
export const POST = apiRoute({ permission: SPECIALTY_MANAGE, resource: "POST /api/v1/specialties" }, async ({ ctx, request }) =>
  createSpecialty(ctx, await request.json())
);

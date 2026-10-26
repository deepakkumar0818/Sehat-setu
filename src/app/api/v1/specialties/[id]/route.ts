import { apiRoute } from "@/server/api/route-handler";
import { SPECIALTY_MANAGE, updateSpecialty } from "@/server/data/clinic-setup";

/** Rename or describe one of the clinic's own specialties (the shared catalogue can't be changed). */
export const PATCH = apiRoute<{ id: string }>({ permission: SPECIALTY_MANAGE, resource: "PATCH /api/v1/specialties/[id]" }, async ({ ctx, params, request }) =>
  updateSpecialty(ctx, params.id, await request.json())
);

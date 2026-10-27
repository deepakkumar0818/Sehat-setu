import { apiRoute } from "@/server/api/route-handler";
import { PATIENT_ADMIN, setPatientAccess } from "@/server/data/patients";

/** Block or unblock a patient: { status: "active" | "blocked" } (Administrators). */
export const PATCH = apiRoute<{ id: string }>({ permission: PATIENT_ADMIN, resource: "PATCH /api/v1/patients/[id]/access" }, async ({ ctx, params, request }) =>
  setPatientAccess(ctx, params.id, await request.json())
);

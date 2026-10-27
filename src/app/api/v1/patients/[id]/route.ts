import { apiRoute } from "@/server/api/route-handler";
import { getPatient, PATIENT_ADMIN, PATIENT_VIEW, removePatient, updatePatient } from "@/server/data/patients";

export const GET = apiRoute<{ id: string }>({ permission: PATIENT_VIEW, resource: "GET /api/v1/patients/[id]" }, ({ ctx, params }) =>
  getPatient(ctx, params.id)
);

export const PATCH = apiRoute<{ id: string }>(
  { permission: ["patient.update", "patient.update_basic_info"], resource: "PATCH /api/v1/patients/[id]" },
  async ({ ctx, params, request }) => updatePatient(ctx, params.id, await request.json())
);

/** Permanently delete a patient with no history (Administrators). */
export const DELETE = apiRoute<{ id: string }>({ permission: PATIENT_ADMIN, resource: "DELETE /api/v1/patients/[id]" }, ({ ctx, params }) =>
  removePatient(ctx, params.id)
);

import { apiRoute } from "@/server/api/route-handler";
import { CLINICAL_VIEW, getConsultation, updateConsultation } from "@/server/data/clinical";

export const GET = apiRoute<{ id: string }>({ permission: CLINICAL_VIEW, resource: "GET /api/v1/consultations/[id]" }, ({ ctx, params }) =>
  getConsultation(ctx, params.id)
);

/** Save a draft. Assigned doctor only, while in progress. */
export const PATCH = apiRoute<{ id: string }>(
  { permission: ["medical_notes.update", "medical_record.manage", "patient.medical_record.update"], resource: "PATCH /api/v1/consultations/[id]" },
  async ({ ctx, params, request }) => updateConsultation(ctx, params.id, await request.json())
);

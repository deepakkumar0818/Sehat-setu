import { apiRoute } from "@/server/api/route-handler";
import { completeConsultation } from "@/server/data/clinical";

/** Save the final notes and complete the consultation and its appointment. Assigned doctor only. */
export const POST = apiRoute<{ id: string }>(
  { permission: ["medical_notes.update", "medical_record.manage", "patient.medical_record.update"], resource: "POST /api/v1/consultations/[id]/complete" },
  async ({ ctx, params, request }) => completeConsultation(ctx, params.id, await request.json())
);

import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { CLINICAL_VIEW, listConsultations, listConsultationsSchema, startConsultation } from "@/server/data/clinical";

export const GET = apiRoute({ permission: CLINICAL_VIEW, resource: "GET /api/v1/consultations" }, ({ ctx, request }) =>
  listConsultations(ctx, listConsultationsSchema.parse(searchParamsOf(request)))
);

/** Start the consultation for a checked-in appointment: { appointmentId }. Assigned doctor only. */
export const POST = apiRoute(
  { permission: ["medical_notes.create", "medical_record.manage", "patient.medical_record.update"], resource: "POST /api/v1/consultations" },
  async ({ ctx, request }) => {
    const body: unknown = await request.json();
    return startConsultation(ctx, body && typeof body === "object" && "appointmentId" in body ? String(body.appointmentId) : "");
  }
);

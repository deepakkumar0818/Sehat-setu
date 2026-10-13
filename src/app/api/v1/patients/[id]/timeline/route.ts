import { apiRoute } from "@/server/api/route-handler";
import { getPatientTimeline } from "@/server/data/clinical";
import { PATIENT_VIEW } from "@/server/data/patients";

export const GET = apiRoute<{ id: string }>({ permission: PATIENT_VIEW, resource: "GET /api/v1/patients/[id]/timeline" }, ({ ctx, params }) =>
  getPatientTimeline(ctx, params.id)
);

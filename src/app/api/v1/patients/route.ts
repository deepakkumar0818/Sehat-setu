import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { createPatient, listPatients, listPatientsSchema, PATIENT_VIEW } from "@/server/data/patients";

export const GET = apiRoute({ permission: PATIENT_VIEW, resource: "GET /api/v1/patients" }, ({ ctx, request }) =>
  listPatients(ctx, listPatientsSchema.parse(searchParamsOf(request)))
);

export const POST = apiRoute({ permission: "patient.create", resource: "POST /api/v1/patients" }, async ({ ctx, request }) =>
  createPatient(ctx, await request.json())
);

import { apiRoute } from "@/server/api/route-handler";
import { getPatientReportedForStaff, PATIENT_REPORTED_READ } from "@/server/data/patient-intake";

// P6.5: the patient's own onboarding answers and symptom questionnaires
// (patient-reported, read-only) for staff with medical-record permission. The
// database decides per patient (branch scope, doctor assignment); a patient
// the caller may not see is a 404.
export const GET = apiRoute<{ id: string }>({ permission: PATIENT_REPORTED_READ, resource: "GET /api/v1/patients/[id]/patient-reported" }, ({ ctx, params }) =>
  getPatientReportedForStaff(ctx, params.id)
);

import { useQuery } from "@tanstack/react-query";
import { liveApi } from "@/lib/live-api";

// P6.5: a patient's patient-reported onboarding answers — live staff app only
// (medical-record permission; the API answers 403/404 otherwise).
export function usePatientReported(patientId: string) {
  return useQuery({ queryKey: ["patient-reported", patientId], queryFn: () => liveApi.patients.patientReported(patientId), retry: false });
}

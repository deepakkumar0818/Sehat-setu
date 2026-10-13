import { useQuery } from "@tanstack/react-query";
import { getClinic, getClinicDoctors, listClinics } from "@/services/clinics";

export function useClinics(search = "") {
  return useQuery({ queryKey: ["clinics", "list", search], queryFn: () => listClinics(search) });
}

export function useClinic(id: string | undefined) {
  return useQuery({ queryKey: ["clinics", "detail", id], queryFn: () => getClinic(id as string), enabled: Boolean(id) });
}

export function useClinicDoctors(id: string | undefined) {
  return useQuery({ queryKey: ["clinics", "doctors", id], queryFn: () => getClinicDoctors(id as string), enabled: Boolean(id) });
}

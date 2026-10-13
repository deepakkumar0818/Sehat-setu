import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getClinic,
  listClinicsForPlatform,
  onboardClinic,
  updateClinicSettings,
  updateClinicStatus,
  type OnboardClinicInput,
} from "@/services/tenant-clinics";
import type { Clinic } from "@/types";

export function useClinicsForPlatform() {
  return useQuery({ queryKey: ["tenant-clinics", "list"], queryFn: () => listClinicsForPlatform() });
}

export function useTenantClinic(id: string | undefined) {
  return useQuery({ queryKey: ["tenant-clinics", "detail", id], queryFn: () => getClinic(id as string), enabled: Boolean(id) });
}

export function useOnboardClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardClinicInput) => onboardClinic(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-clinics"] }),
  });
}

export function useUpdateClinicSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Clinic["settings"]> }) => updateClinicSettings(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-clinics"] }),
  });
}

export function useUpdateClinicStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Clinic["status"] }) => updateClinicStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-clinics"] }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSpecialty,
  listSpecialtiesForClinic,
  listSpecialtyCatalog,
  setClinicSpecialtyEnabled,
  toggleSpecialtyStatus,
  type CreateSpecialtyInput,
} from "@/services/specialties";
import type { AuthUser, Specialty } from "@/types";

export function useSpecialtyCatalog(search = "") {
  return useQuery({ queryKey: ["specialties", "catalog", search], queryFn: () => listSpecialtyCatalog(search) });
}

export function useSpecialtiesForClinic(clinicId: string | undefined) {
  return useQuery({ queryKey: ["specialties", "clinic", clinicId], queryFn: () => listSpecialtiesForClinic(clinicId as string), enabled: Boolean(clinicId) });
}

export function useSetClinicSpecialtyEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, specialtyId, enabled, actor }: { clinicId: string; specialtyId: string; enabled: boolean; actor: Pick<AuthUser, "name" | "role"> }) =>
      setClinicSpecialtyEnabled(clinicId, specialtyId, enabled, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["specialties"] }),
  });
}

export function useCreateSpecialty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSpecialtyInput) => createSpecialty(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["specialties"] }),
  });
}

export function useToggleSpecialtyStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ specialtyId, status }: { specialtyId: string; status: Specialty["status"] }) => toggleSpecialtyStatus(specialtyId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["specialties"] }),
  });
}

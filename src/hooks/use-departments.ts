import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDepartment,
  getDepartment,
  listAssignableStaffForDepartment,
  listDepartments,
  updateDepartment,
  type CreateDepartmentInput,
  type ListDepartmentsParams,
} from "@/services/departments";
import type { Department } from "@/types";

export function useDepartments(params: ListDepartmentsParams) {
  return useQuery({ queryKey: ["departments", "list", params], queryFn: () => listDepartments(params), enabled: Boolean(params.clinicId) });
}

export function useDepartment(id: string | undefined) {
  return useQuery({ queryKey: ["departments", "detail", id], queryFn: () => getDepartment(id as string), enabled: Boolean(id) });
}

export function useAssignableStaffForDepartment(clinicId: string | undefined, branchId: string | undefined) {
  return useQuery({
    queryKey: ["departments", "assignable", clinicId, branchId],
    queryFn: () => listAssignableStaffForDepartment(clinicId as string, branchId as string),
    enabled: Boolean(clinicId && branchId),
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDepartmentInput) => createDepartment(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Department, "name" | "description" | "headUserId" | "specialtyId" | "status">> }) =>
      updateDepartment(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
  });
}

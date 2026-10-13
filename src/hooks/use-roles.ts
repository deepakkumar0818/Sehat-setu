import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCustomRole,
  duplicateRoleAsCustom,
  listRolesForClinic,
  updateCustomRolePermissions,
  type CreateCustomRoleInput,
} from "@/services/roles";
import type { AuthUser } from "@/types";

export function useRolesForClinic(clinicId: string | undefined) {
  return useQuery({ queryKey: ["roles", "clinic", clinicId], queryFn: () => listRolesForClinic(clinicId as string), enabled: Boolean(clinicId) });
}

export function useCreateCustomRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomRoleInput) => createCustomRole(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useUpdateCustomRolePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionKeys, actor }: { roleId: string; permissionKeys: string[]; actor: Pick<AuthUser, "name" | "role"> }) =>
      updateCustomRolePermissions(roleId, permissionKeys, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useDuplicateRoleAsCustom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, newName, actor }: { roleId: string; newName: string; actor: Pick<AuthUser, "name" | "role"> }) =>
      duplicateRoleAsCustom(roleId, newName, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

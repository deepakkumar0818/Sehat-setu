import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBranch, listBranchesForClinic, updateBranchStatus, type CreateBranchInput } from "@/services/tenant-branches";
import type { AuthUser, Branch } from "@/types";

export function useBranchesForClinic(clinicId: string | undefined, search = "") {
  return useQuery({ queryKey: ["tenant-branches", clinicId, search], queryFn: () => listBranchesForClinic(clinicId as string, search), enabled: Boolean(clinicId) });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBranchInput) => createBranch(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-branches"] }),
  });
}

export function useUpdateBranchStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, actor }: { id: string; status: Branch["status"]; actor: Pick<AuthUser, "name" | "role"> }) =>
      updateBranchStatus(id, status, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-branches"] }),
  });
}

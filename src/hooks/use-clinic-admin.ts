import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveApi } from "@/lib/live-api";
import type { AuditArea, BranchInput, ClinicProfileInput, DepartmentInput, ExpenseInput, LiveDepartment, LiveExpenseCategory } from "@/lib/live-types";
import type { Branch } from "@/types";

// Clinic-admin screens in the live staff app (clinic database only): branches,
// departments, specialties, clinic profile, audit log and expenses. Demo mode
// keeps its own hooks (use-tenant-branches, use-departments, use-specialties, …).

const keys = {
  branches: ["branches", "live"] as const,
  departments: ["departments", "live"] as const,
  specialties: ["specialties", "usage", "live"] as const,
  clinic: ["clinic", "live"] as const,
  audit: ["audit-events", "live"] as const,
  expenses: ["expenses", "live"] as const,
};

/** After a setup change: lists that show branches/departments/specialties anywhere in the app. */
function useInvalidateSetup() {
  const qc = useQueryClient();
  return () => {
    for (const key of [keys.branches, keys.departments, keys.specialties, keys.clinic, keys.audit]) qc.invalidateQueries({ queryKey: key });
  };
}

// --- Branches ------------------------------------------------------------------

export function useLiveBranchList() {
  return useQuery({ queryKey: keys.branches, queryFn: liveApi.branches.list, staleTime: 5 * 60_000 });
}

export function useCreateLiveBranch() {
  const invalidate = useInvalidateSetup();
  return useMutation({ mutationFn: (input: BranchInput) => liveApi.branches.create(input), onSuccess: invalidate });
}

export function useUpdateLiveBranch() {
  const invalidate = useInvalidateSetup();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<BranchInput, "code">> }) => liveApi.branches.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useSetLiveBranchStatus() {
  const invalidate = useInvalidateSetup();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: Branch["status"] }) => liveApi.branches.setStatus(id, status), onSuccess: invalidate });
}

// --- Departments ---------------------------------------------------------------

export function useLiveDepartments() {
  return useQuery({ queryKey: keys.departments, queryFn: liveApi.departments.list });
}

export function useCreateLiveDepartment() {
  const invalidate = useInvalidateSetup();
  return useMutation({ mutationFn: (input: DepartmentInput) => liveApi.departments.create(input), onSuccess: invalidate });
}

export function useUpdateLiveDepartment() {
  const invalidate = useInvalidateSetup();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<DepartmentInput, "branchId">> }) => liveApi.departments.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useSetLiveDepartmentStatus() {
  const invalidate = useInvalidateSetup();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: LiveDepartment["status"] }) => liveApi.departments.setStatus(id, status), onSuccess: invalidate });
}

// --- Specialties / clinic --------------------------------------------------------

export function useLiveSpecialtyUsage() {
  return useQuery({ queryKey: keys.specialties, queryFn: liveApi.specialties.usage });
}

export function useClinicProfile() {
  return useQuery({ queryKey: keys.clinic, queryFn: liveApi.clinic.get });
}

export function useUpdateClinicProfile() {
  const invalidate = useInvalidateSetup();
  return useMutation({ mutationFn: (patch: Partial<ClinicProfileInput>) => liveApi.clinic.update(patch), onSuccess: invalidate });
}

// --- Audit log -------------------------------------------------------------------

export function useLiveAuditLog(params: { area?: AuditArea; outcome?: "success" | "denied" | "failure"; search?: string; page: number; pageSize?: number }) {
  return useQuery({ queryKey: [...keys.audit, params], queryFn: () => liveApi.auditEvents(params), placeholderData: keepPreviousData });
}

// --- Expenses --------------------------------------------------------------------

export function useLiveExpenses(params: { search?: string; category?: LiveExpenseCategory; branchId?: string; status?: "recorded" | "voided" | "all"; page: number; pageSize?: number }) {
  return useQuery({ queryKey: [...keys.expenses, params], queryFn: () => liveApi.expenses.list(params), placeholderData: keepPreviousData });
}

function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.expenses });
    qc.invalidateQueries({ queryKey: ["billing"] });
    qc.invalidateQueries({ queryKey: keys.audit });
  };
}

export function useCreateLiveExpense() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (input: ExpenseInput) => liveApi.expenses.create(input), onSuccess: invalidate });
}

export function useVoidLiveExpense() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => liveApi.expenses.void(id, reason), onSuccess: invalidate });
}

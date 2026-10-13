import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import {
  adjustStock,
  createMedicine,
  getInventorySummary,
  getMedicine,
  listMedicines,
  type CreateMedicineInput,
  type ListMedicinesParams,
  type ListStockParams,
  type ReceiveStockInput,
} from "@/services/inventory";

// In the authenticated staff app (live) inventory comes from the clinic
// database: stock per medicine per branch, changed only through recorded
// movements. Demo mode keeps the mock medicine list. Query keys carry the source.
const src = (live: boolean) => (live ? "live" : "mock");

// --- demo data ---------------------------------------------------------------------

export function useMedicines(params: ListMedicinesParams) {
  return useQuery({ queryKey: queryKeys.inventory.list(params), queryFn: () => listMedicines(params), placeholderData: (p) => p });
}

export function useMedicine(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.inventory.detail(id ?? ""), queryFn: () => getMedicine(id as string), enabled: Boolean(id) });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, delta, reference }: { id: string; delta: number; reference?: string }) => adjustStock(id, delta, reference),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
    },
  });
}

export function useCreateMedicine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMedicineInput) => createMedicine(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
  });
}

// --- both sources ---------------------------------------------------------------------

/** Status counts. Live: from the clinic database for the user's branch scope (and `branchId`, if given). */
export function useInventorySummary(options: { enabled?: boolean; branchId?: string } = {}) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.inventory.summary, options.branchId ?? "all", src(live)],
    queryFn: () => (live ? liveApi.inventory.summary(options.branchId) : getInventorySummary()),
    enabled: options.enabled ?? true,
  });
}

// --- clinic database ---------------------------------------------------------------------

export function useStock(params: ListStockParams) {
  return useQuery({ queryKey: [...queryKeys.inventory.list(params), "live"], queryFn: () => liveApi.inventory.list(params), placeholderData: (p) => p });
}

export function useStockDetail(branchId: string | undefined, medicineId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.inventory.detail(`${branchId}:${medicineId}`), "live"],
    queryFn: () => liveApi.inventory.detail(branchId as string, medicineId as string),
    enabled: Boolean(branchId && medicineId),
  });
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
}

export function useReceiveStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (input: ReceiveStockInput) => liveApi.inventory.receive(input), onSuccess: invalidate });
}

export function useAdjustBatch() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ itemId, quantityDelta, reason }: { itemId: string; quantityDelta: number; reason: string }) => liveApi.inventory.adjust(itemId, quantityDelta, reason),
    onSuccess: invalidate,
  });
}

export function useReverseMovement() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: ({ movementId, reason }: { movementId: string; reason?: string }) => liveApi.inventory.reverse(movementId, reason), onSuccess: invalidate });
}

export function useSetReorderLevel() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ branchId, medicineId, reorderLevel }: { branchId: string; medicineId: string; reorderLevel: number }) =>
      liveApi.inventory.setReorderLevel(branchId, medicineId, reorderLevel),
    onSuccess: invalidate,
  });
}

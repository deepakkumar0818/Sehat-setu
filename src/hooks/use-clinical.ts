import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import {
  completeConsultation,
  createPrescription,
  createReport,
  getConsultation,
  getPrescription,
  getReport,
  listConsultations,
  listDocuments,
  listPrescriptions,
  listReports,
  shareReportWithPatient,
  updateConsultation,
  type CreateCatalogMedicineInput,
  type CreateLivePrescriptionInput,
  type CreatePrescriptionInput,
  type CreateReportInput,
  type ListConsultationsParams,
  type ListDocumentsParams,
  type ListPrescriptionsParams,
  type ListReportsParams,
} from "@/services/clinical";
import type { Consultation } from "@/types";

// Consultations and prescriptions come from the clinic database API in the
// authenticated staff app (live) and from the mock services elsewhere. Lab
// reports and documents stay mock-only until their phase. Query keys carry the source.
const src = (live: boolean) => (live ? "live" : "mock");

export function useConsultations(params: ListConsultationsParams) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.consultations.list(params), src(live)],
    queryFn: () => (live ? liveApi.consultations.list(params) : listConsultations(params)),
    placeholderData: (p) => p,
  });
}

export function useConsultation(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.consultations.detail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.consultations.get(id as string) : getConsultation(id as string)),
    enabled: Boolean(id),
  });
}

export function useUpdateConsultation() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Consultation> }): Promise<void> => {
      if (live) await liveApi.consultations.update(id, patch);
      else await updateConsultation(id, patch);
    },
    onSuccess: (_d, vars) => queryClient.invalidateQueries({ queryKey: queryKeys.consultations.detail(vars.id) }),
  });
}

export function useCompleteConsultation() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Consultation> }): Promise<void> => {
      if (live) await liveApi.consultations.complete(id, patch);
      else await completeConsultation(id, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
    },
  });
}

export function usePrescriptions(params: ListPrescriptionsParams) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.prescriptions.list(params), src(live)],
    queryFn: () => (live ? liveApi.prescriptions.list(params) : listPrescriptions(params)),
    placeholderData: (p) => p,
  });
}

export function usePrescription(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.prescriptions.detail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.prescriptions.get(id as string) : getPrescription(id as string)),
    enabled: Boolean(id),
  });
}

/** Clinic database: prescribe from the medicine catalogue for a consultation (assigned doctor only). */
export function useCreateLivePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLivePrescriptionInput) => liveApi.prescriptions.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
    },
  });
}

const CATALOG_KEY = "medicine-catalog";

/** Server-side search of the shared catalogue, 20 per page with "load more" (clinic database only). */
export function useMedicineSearch(search: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: [CATALOG_KEY, search],
    queryFn: ({ pageParam }) => liveApi.catalog.search({ search: search || undefined, page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60_000,
  });
}

/** Adds a medicine to the shared catalogue (Administrator). Errors are shown by the form, not as toasts. */
export function useCreateCatalogMedicine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCatalogMedicineInput) => liveApi.catalog.create(input),
    meta: { inlineErrors: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [CATALOG_KEY] }),
  });
}

export function useCreatePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePrescriptionInput) => createPrescription(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
    },
  });
}

export function useReports(params: ListReportsParams) {
  return useQuery({ queryKey: queryKeys.reports.list(params), queryFn: () => listReports(params), placeholderData: (p) => p });
}

export function useReport(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.reports.detail(id ?? ""), queryFn: () => getReport(id as string), enabled: Boolean(id) });
}

export function useCreateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportInput) => createReport(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
    },
  });
}

export function useShareReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => shareReportWithPatient(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
  });
}

export function useDocuments(params: ListDocumentsParams) {
  return useQuery({ queryKey: queryKeys.documents.list(params), queryFn: () => listDocuments(params), placeholderData: (p) => p });
}

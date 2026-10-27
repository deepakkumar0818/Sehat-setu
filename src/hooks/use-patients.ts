import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import {
  createPatient,
  getPatient,
  getPatientTimeline,
  listPatients,
  registerPatient,
  setPatientStatus,
  updatePatient,
  type CreatePatientInput,
  type ListPatientsParams,
  type RegisterPatientInput,
} from "@/services/patients";
import type { Patient, PatientStatus } from "@/types";

// In the authenticated staff app (live) these call the clinic database API;
// elsewhere they use the in-browser mock services. Query keys carry the source
// so the two never share cache entries.
const src = (live: boolean) => (live ? "live" : "mock");

export function usePatients(params: ListPatientsParams) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.patients.list(params), src(live)],
    queryFn: () => (live ? liveApi.patients.list(params) : listPatients(params)),
    placeholderData: (prev) => prev,
  });
}

export function usePatient(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.patients.detail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.patients.get(id as string) : getPatient(id as string)),
    enabled: Boolean(id),
  });
}

export function usePatientTimeline(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.patients.timeline(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.patients.timeline(id as string) : getPatientTimeline(id as string)),
    enabled: Boolean(id),
  });
}

export function useCreatePatient() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePatientInput) => (live ? liveApi.patients.create(input) : createPatient(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
    },
  });
}

export function useRegisterPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterPatientInput) => registerPatient(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
  });
}

export function useUpdatePatient() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Patient> }) => (live ? liveApi.patients.update(id, patch) : updatePatient(id, patch)),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.detail(variables.id) });
    },
  });
}

/** Live data only: an Administrator blocks or unblocks a patient (record and portal access). */
export function useSetPatientAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "blocked" }) => liveApi.patients.setAccess(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
  });
}

/** Live data only: an Administrator deletes a patient with no history. */
export function useRemovePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => liveApi.patients.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
  });
}

export function useSetPatientStatus() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PatientStatus }): Promise<void> => {
      if (live) await liveApi.patients.setStatus(id, status);
      else await setPatientStatus(id, status);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
  });
}

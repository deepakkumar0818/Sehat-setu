import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import {
  cancelAppointment,
  checkInAppointment,
  createAppointment,
  getAppointment,
  getTodaysAppointments,
  getWaitingRoom,
  listAppointments,
  markNoShow,
  rescheduleAppointment,
  startConsultation,
  type CreateAppointmentInput,
  type ListAppointmentsParams,
} from "@/services/appointments";

// Live (authenticated staff app): clinic database API. Otherwise: mock services.
const src = (live: boolean) => (live ? "live" : "mock");

export function useAppointments(params: ListAppointmentsParams, options: { enabled?: boolean } = {}) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.appointments.list(params), src(live)],
    queryFn: () => (live ? liveApi.appointments.list(params) : listAppointments(params)),
    placeholderData: (prev) => prev,
    enabled: options.enabled ?? true,
  });
}

export function useAppointment(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.appointments.detail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.appointments.get(id as string) : getAppointment(id as string)),
    enabled: Boolean(id),
  });
}

export function useTodaysAppointments(branchId?: string) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.appointments.today(branchId), src(live)],
    queryFn: () => (live ? liveApi.appointments.today(branchId) : getTodaysAppointments(branchId)),
  });
}

export function useWaitingRoom(branchId?: string) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.appointments.waitingRoom(branchId), src(live)],
    queryFn: () => (live ? liveApi.appointments.waitingRoom(branchId) : getWaitingRoom(branchId)),
    refetchInterval: 30_000,
  });
}

function useInvalidateAppointments() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
    queryClient.invalidateQueries({ queryKey: ["availability"] });
  };
}

export function useCreateAppointment() {
  const live = useLiveData();
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) => (live ? liveApi.appointments.create(input) : createAppointment(input)),
    onSuccess: invalidate,
  });
}

export function useCheckInAppointment() {
  const live = useLiveData();
  const invalidate = useInvalidateAppointments();
  return useMutation({ mutationFn: (id: string) => (live ? liveApi.appointments.checkIn(id) : checkInAppointment(id)), onSuccess: invalidate });
}

export function useCancelAppointment() {
  const live = useLiveData();
  const invalidate = useInvalidateAppointments();
  return useMutation({ mutationFn: (id: string) => (live ? liveApi.appointments.cancel(id) : cancelAppointment(id)), onSuccess: invalidate });
}

export function useMarkNoShow() {
  const live = useLiveData();
  const invalidate = useInvalidateAppointments();
  return useMutation({ mutationFn: (id: string) => (live ? liveApi.appointments.noShow(id) : markNoShow(id)), onSuccess: invalidate });
}

export function useRescheduleAppointment() {
  const live = useLiveData();
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, date, time }: { id: string; date: string; time: string }) =>
      live ? liveApi.appointments.reschedule(id, date, time) : rescheduleAppointment(id, date, time),
    onSuccess: invalidate,
  });
}

export function useStartConsultation() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: async (id: string): Promise<{ consultation: { id: string } }> =>
      live ? { consultation: await liveApi.consultations.start(id) } : startConsultation(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: queryKeys.consultations.all });
    },
  });
}

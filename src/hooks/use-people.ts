import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi, notConnected } from "@/lib/live-api";
import {
  createDoctor,
  createStaff,
  getDoctor,
  getStaffMember,
  listDoctors,
  listStaff,
  updateStaffStatus,
  type CreateDoctorInput,
  type CreateStaffInput,
  type ListDoctorsParams,
  type ListStaffParams,
} from "@/services/people";
import type { Doctor, StaffMember } from "@/types";
import type { SpecialtyOption } from "@/lib/live-types";
import { SPECIALIZATIONS } from "@/data/pools";
import { useDataStore } from "@/store/data-store";

// Live (authenticated staff app): clinic database API. Otherwise: mock services.
const src = (live: boolean) => (live ? "live" : "mock");

export function useDoctors(params: ListDoctorsParams & { status?: "active" | "inactive" | "all" } = {}) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.doctors.list(params), src(live)],
    queryFn: () => (live ? liveApi.doctors.list(params) : listDoctors(params)),
    placeholderData: (p) => p,
  });
}

const NO_DOCTORS: Doctor[] = [];

/** Active doctors for pickers and filters: the clinic database when live, the mock store otherwise. */
export function useDoctorOptions(): Doctor[] {
  const live = useLiveData();
  const mockDoctors = useDataStore((s) => s.db.doctors);
  const { data } = useQuery({
    queryKey: [...queryKeys.doctors.list({ status: "active", pageSize: 200 }), "live"],
    queryFn: () => liveApi.doctors.list({ status: "active", pageSize: 200 }),
    enabled: live,
    staleTime: 60_000,
  });
  return live ? (data?.items ?? NO_DOCTORS) : mockDoctors;
}

/**
 * Specialty filter/picker options: the clinic database's specialty catalogue when
 * live; the demo list (src/data/pools.ts) only in demo mode.
 */
export function useSpecialtyOptions() {
  const live = useLiveData();
  return useQuery({
    queryKey: ["specialties", "options", src(live)],
    queryFn: async (): Promise<SpecialtyOption[]> => (live ? (await liveApi.specialties.list()).items : SPECIALIZATIONS.map((name) => ({ id: name, name }))),
    staleTime: 5 * 60_000,
  });
}

export function useDoctor(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.doctors.detail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.doctors.get(id as string) : getDoctor(id as string)),
    enabled: Boolean(id),
  });
}

/** Mock only: in live mode new doctors are provisioned and invited (npm run auth:provision + Supabase invite). */
export function useCreateDoctor() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDoctorInput) => (live ? notConnected("Adding doctors from the app") : createDoctor(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.doctors.all }),
  });
}

/** Live data only: an Administrator suspends (inactive) or reactivates a doctor. */
export function useSetDoctorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Doctor["status"] }) => liveApi.doctors.setStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.doctors.all }),
  });
}

/** Live data only: an Administrator deletes a doctor with no appointments or lab reports. */
export function useRemoveDoctor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => liveApi.doctors.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.doctors.all }),
  });
}

export function useStaff(params: ListStaffParams = {}) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.staff.list(params), src(live)],
    queryFn: () => (live ? liveApi.staff.list(params) : listStaff(params)),
    placeholderData: (p) => p,
  });
}

export function useStaffMember(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.staff.detail(id ?? ""), src(live)],
    queryFn: () => (live ? notConnected("Staff profiles") : getStaffMember(id as string)),
    enabled: Boolean(id) && !live,
  });
}

/** Mock only: in live mode new staff are provisioned and invited (npm run auth:provision + Supabase invite). */
export function useCreateStaff() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => (live ? notConnected("Adding staff from the app") : createStaff(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all }),
  });
}

export function useUpdateStaffStatus() {
  const live = useLiveData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StaffMember["status"] }): Promise<void> => {
      if (live) await liveApi.staff.setStatus(id, status);
      else await updateStaffStatus(id, status);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all }),
  });
}

/** Live data only: an Administrator edits a staff member's name, phone and/or branch; the dialog shows errors inline. */
export function useUpdateStaffDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; phone?: string; branchId?: string | null } }) => liveApi.staff.updateDetails(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all }),
    meta: { inlineErrors: true },
  });
}

/** Live data only: an Administrator deletes a staff member. */
export function useRemoveStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => liveApi.staff.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all }),
  });
}

/** Live data only: an Administrator sets a staff member's phone (E.164); the dialog shows errors inline. */
export function useUpdateStaffPhone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, phone }: { id: string; phone: string }) => liveApi.staff.setPhone(id, phone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff.all }),
    meta: { inlineErrors: true },
  });
}

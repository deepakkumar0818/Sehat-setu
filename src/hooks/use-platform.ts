import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveApi } from "@/lib/live-api";
import type {
  PlatformActivityKind,
  PlatformClinicInput,
  PlatformClinicProfileInput,
  PlatformPlanInput,
  PlatformSubscriptionInput,
  SubscriptionPaymentInput,
} from "@/lib/live-types";

// The Sehat Setu super admin console (/platform): every clinic, one clinic in
// detail, plans, subscriptions and payments, administrators, the activity log.

const ROOT = ["platform"] as const;
const KEY = ["platform", "clinics"] as const;
const clinicKey = (id: string) => ["platform", "clinic", id] as const;
const PLANS = ["platform", "plans"] as const;

/** After any change: the list, the clinic's page, plans (clinic counts) and the activity log. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function usePlatformOverview() {
  return useQuery({ queryKey: KEY, queryFn: liveApi.platform.overview });
}

export function usePlatformClinic(id: string) {
  return useQuery({ queryKey: clinicKey(id), queryFn: () => liveApi.platform.clinic(id) });
}

export function useCreatePlatformClinic() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: PlatformClinicInput) => liveApi.platform.createClinic(input), onSuccess: invalidate });
}

export function useSetPlatformClinicStatus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => liveApi.platform.setStatus(id, status),
    onSuccess: invalidate,
  });
}

export function useResendClinicAdminInvite() {
  return useMutation({ mutationFn: ({ id, email }: { id: string; email: string }) => liveApi.platform.resendInvite(id, email) });
}

export function useUpdatePlatformClinic(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: PlatformClinicProfileInput) => liveApi.platform.updateClinic(id, input), onSuccess: invalidate });
}

export function useAddClinicAdmin(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: { name: string; email: string }) => liveApi.platform.addAdmin(id, input), onSuccess: invalidate });
}

export function useRemoveClinicAdmin(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (userId: string) => liveApi.platform.removeAdmin(id, userId), onSuccess: invalidate });
}

export function useSetSubscription(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: PlatformSubscriptionInput) => liveApi.platform.setSubscription(id, input), onSuccess: invalidate });
}

export function useRecordSubscriptionPayment(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: SubscriptionPaymentInput) => liveApi.platform.recordPayment(id, input), onSuccess: invalidate });
}

export function useVoidSubscriptionPayment(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) => liveApi.platform.voidPayment(id, paymentId, reason),
    onSuccess: invalidate,
  });
}

export function usePlatformPlans() {
  return useQuery({ queryKey: PLANS, queryFn: liveApi.platform.plans });
}

export function useSavePlatformPlan() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, input: { key, ...rest } }: { id: string | null; input: PlatformPlanInput }) =>
      id ? liveApi.platform.updatePlan(id, rest) : liveApi.platform.createPlan({ key, ...rest }),
    onSuccess: invalidate,
  });
}

/** Newest first, 50 at a time ("Load older" fetches the next page). */
export function usePlatformActivity(filter: { clinicId?: string; kind: PlatformActivityKind }) {
  return useInfiniteQuery({
    queryKey: ["platform", "activity", filter.clinicId ?? "all", filter.kind],
    queryFn: ({ pageParam }) => liveApi.platform.activity({ ...filter, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  });
}

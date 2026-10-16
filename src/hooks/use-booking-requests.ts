import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveApi } from "@/lib/live-api";

// Reception's queue of patient self-booked requests (clinic database only).
// A decision refreshes the queue, the schedule lists and notifications.

const KEY = ["booking-requests", "live"] as const;

export function useBookingRequests(branchId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEY, branchId ?? "all"],
    queryFn: () => liveApi.bookingRequests.list(branchId),
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
}

export function useApproveBookingRequest() {
  const invalidate = useInvalidate();
  // Errors are shown next to the request (slot taken, expired, already handled), not as a toast.
  return useMutation({ mutationFn: (id: string) => liveApi.bookingRequests.approve(id), onSettled: invalidate, meta: { inlineErrors: true } });
}

export function useRejectBookingRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => liveApi.bookingRequests.reject(id, reason),
    onSettled: invalidate,
    meta: { inlineErrors: true },
  });
}

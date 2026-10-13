import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { ApiRequestError } from "@/lib/api-client";
import { liveApi } from "@/lib/live-api";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ListNotificationsParams,
} from "@/services/notifications";

// Where notifications come from — chosen explicitly, never as a fallback:
//  "live"        the staff app with Supabase Auth: the clinic database (/api/v1/notifications);
//  "mock"        demo mode (no Supabase configured): the in-browser demo store;
//  "unavailable" a real signed-in session without staff notifications (the
//                patient portal): nothing is queried and nothing fake is shown.
export type NotificationSource = "live" | "mock" | "unavailable";

export function useNotificationSource(): NotificationSource {
  const live = useLiveData();
  if (live) return "live";
  return isSupabaseAuthEnabled() ? "unavailable" : "mock";
}

/** Refresh cadence: every minute while the tab is visible, and when the user comes back to it. */
const LIVE_REFRESH = { refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, staleTime: 15_000 } as const;

/** 503 FEATURE_UNAVAILABLE: the notifications migration isn't applied on this database yet. */
export const isFeatureUnavailable = (error: unknown) => error instanceof ApiRequestError && error.code === "FEATURE_UNAVAILABLE";

// --- Live (clinic database) ----------------------------------------------------------

export function useLiveNotificationFeed(options: { unread?: boolean; limit?: number; enabled?: boolean } = {}) {
  const source = useNotificationSource();
  return useInfiniteQuery({
    queryKey: ["notifications", "live", "feed", { unread: Boolean(options.unread), limit: options.limit ?? 20 }],
    queryFn: ({ pageParam }) => liveApi.notifications.list({ cursor: pageParam, limit: options.limit ?? 20, unread: options.unread }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: source === "live" && options.enabled !== false,
    ...LIVE_REFRESH,
  });
}

export function useLiveUnreadCount() {
  const source = useNotificationSource();
  return useQuery({
    queryKey: ["notifications", "live", "unread"],
    queryFn: liveApi.notifications.unreadCount,
    enabled: source === "live",
    ...LIVE_REFRESH,
  });
}

export function useLiveMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => liveApi.notifications.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "live"] }),
  });
}

/**
 * `newestSeen` = createdAt of the newest notification the user has been shown
 * (a server timestamp): everything up to it is marked read, anything that
 * arrived since stays unread.
 */
export function useLiveMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newestSeen: string) => liveApi.notifications.markAllRead(newestSeen),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "live"] }),
  });
}

// --- Demo mode (in-browser mock store). Disabled unless the source is "mock". -----------

export function useNotifications(params: ListNotificationsParams) {
  const source = useNotificationSource();
  return useQuery({ queryKey: [...queryKeys.notifications.list(params), "mock"], queryFn: () => listNotifications(params), enabled: source === "mock" });
}

export function useUnreadCount(role?: string, patientId?: string) {
  const source = useNotificationSource();
  return useQuery({
    queryKey: [...queryKeys.notifications.unreadCount(role, patientId), "mock"],
    queryFn: () => getUnreadCount(role as never, patientId),
    enabled: source === "mock",
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, patientId }: { role?: string; patientId?: string }) => markAllNotificationsRead(role as never, patientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

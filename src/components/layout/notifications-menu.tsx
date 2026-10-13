"use client";

import Link from "next/link";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  useLiveUnreadCount,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationSource,
  useNotifications,
  useUnreadCount,
} from "@/hooks/use-notifications";
import { LiveNotificationMenuContent, NotificationsUnavailable, unreadBadgeText } from "@/components/notifications/live-notifications";
import { cn } from "@/lib/utils";

// The header bell, in both the staff app and the patient portal. Its source is
// explicit (see useNotificationSource): live data in the staff app, the demo
// store only in demo mode, and an "unavailable" state for real portal sessions.
// The demo store is never queried when Supabase Auth is configured.

function Badge({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">{text}</span>
  );
}

export function NotificationsMenu() {
  const source = useNotificationSource();
  const user = useCurrentUser();
  const liveCount = useLiveUnreadCount();
  const badge = source === "live" ? unreadBadgeText(liveCount.data) : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <BellIcon className="h-5 w-5" />
          {source === "live" && <Badge text={badge} />}
          {source === "mock" && <DemoBadge />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {source === "live" ? (
          <LiveNotificationMenuContent hasUnread={Boolean(badge)} />
        ) : source === "mock" ? (
          <DemoMenuContent />
        ) : (
          <>
            <div className="border-b px-3 py-2.5">
              <p className="text-sm font-medium">Notifications</p>
            </div>
            <NotificationsUnavailable compact />
          </>
        )}
        {source !== "unavailable" && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" asChild>
              <Link href={user?.role === "patient" ? "/portal" : "/notifications"}>View all notifications</Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Demo mode only (fictional in-browser data) ------------------------------------

function DemoBadge() {
  const user = useCurrentUser();
  const { data: unreadCount } = useUnreadCount(user?.role, user?.patientId);
  return <Badge text={unreadCount ? String(unreadCount) : null} />;
}

function DemoMenuContent() {
  const user = useCurrentUser();
  const role = user?.role;
  const patientId = user?.patientId;
  const { data: unreadCount } = useUnreadCount(role, patientId);
  const { data, isLoading } = useNotifications({ role, patientId, pageSize: 6 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  return (
    <>
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <p className="text-sm font-medium">Notifications</p>
        {Boolean(unreadCount) && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => markAllRead.mutate({ role, patientId })}>
            <CheckCheckIcon className="h-3.5 w-3.5" /> Mark all read
          </Button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : data && data.items.length > 0 ? (
          data.items.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.read && markRead.mutate(n.id)}
              className={cn("flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted", !n.read && "bg-accent/40")}
            >
              <div className="flex items-center gap-2">
                {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                <p className="text-sm font-medium text-foreground">{n.title}</p>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
              <p className="text-[11px] text-muted-foreground">{formatRelativeTime(n.date)}</p>
            </button>
          ))
        ) : (
          <EmptyState title="No notifications" description="You're all caught up." className="border-0 py-8" />
        )}
      </div>
    </>
  );
}

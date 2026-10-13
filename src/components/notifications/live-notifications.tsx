"use client";

import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { BellIcon, BellOffIcon, CheckCheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { cn } from "@/lib/utils";
import type { LiveNotification, UnreadCount } from "@/lib/live-types";
import { isFeatureUnavailable, useLiveMarkAllRead, useLiveMarkRead, useLiveNotificationFeed } from "@/hooks/use-notifications";

// The live notification centre (clinic database). Text comes from the server's
// fixed templates; links go to pages that enforce their own permissions. There
// is no mock fallback: errors and "not set up yet" are shown as such.

const timeAgo = (iso: string) => {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
};

/** "3", "99+", or nothing. */
export function unreadBadgeText(count: UnreadCount | undefined): string | null {
  if (!count || count.count <= 0) return null;
  return count.capped ? `${count.count}+` : String(count.count);
}

export function NotificationsUnavailable({ compact = false }: { compact?: boolean }) {
  return (
    <EmptyState
      icon={BellOffIcon}
      title="Notifications aren't available yet"
      description="Notifications haven't been set up for this clinic yet. Nothing is missing — there's just nothing to show here."
      className={compact ? "border-0 py-8" : undefined}
    />
  );
}

function NotificationRow({ n, onOpen, compact }: { n: LiveNotification; onOpen: (n: LiveNotification) => void; compact?: boolean }) {
  const content = (
    <>
      <div className="flex items-center gap-2">
        {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        <p className="text-sm font-medium text-foreground">{n.title}</p>
      </div>
      <p className={cn("text-muted-foreground", compact ? "line-clamp-2 text-xs" : "text-sm")}>{n.body}</p>
      <p className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
    </>
  );
  const className = cn("flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted", !n.read && "bg-accent/40", !compact && "px-4 py-3");
  return n.link ? (
    <Link href={n.link} className={className} onClick={() => onOpen(n)}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => onOpen(n)}>
      {content}
    </button>
  );
}

/** The bell's dropdown list (latest 10). */
export function LiveNotificationMenuContent({ hasUnread }: { hasUnread: boolean }) {
  const feed = useLiveNotificationFeed({ limit: 10 });
  const markRead = useLiveMarkRead();
  const markAll = useLiveMarkAllRead();
  const items = feed.data?.pages[0]?.items ?? [];
  const open = (n: LiveNotification) => !n.read && markRead.mutate(n.id);

  return (
    <>
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <p className="text-sm font-medium">Notifications</p>
        {hasUnread && items.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={markAll.isPending} onClick={() => markAll.mutate(items[0].createdAt)}>
            <CheckCheckIcon className="h-3.5 w-3.5" /> Mark all read
          </Button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {feed.isLoading ? (
          <div className="space-y-3 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : feed.isError ? (
          isFeatureUnavailable(feed.error) ? <NotificationsUnavailable compact /> : <ErrorState title="Couldn't load notifications" description={feed.error.message} onRetry={() => feed.refetch()} className="border-0 py-8" />
        ) : items.length === 0 ? (
          <EmptyState icon={BellIcon} title="No notifications" description="You're all caught up." className="border-0 py-8" />
        ) : (
          items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} compact />)
        )}
      </div>
    </>
  );
}

/** The full /notifications list with "Load more" paging. */
export function LiveNotificationList({ unreadOnly }: { unreadOnly: boolean }) {
  const feed = useLiveNotificationFeed({ unread: unreadOnly, limit: 20 });
  const markRead = useLiveMarkRead();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  if (feed.isLoading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (feed.isError) {
    return isFeatureUnavailable(feed.error) ? <NotificationsUnavailable /> : <ErrorState title="Couldn't load notifications" description={feed.error.message} onRetry={() => feed.refetch()} />;
  }
  if (items.length === 0) {
    return <EmptyState icon={BellIcon} title={unreadOnly ? "No unread notifications" : "No notifications"} description="You're all caught up." />;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border">
        {items.map((n) => (
          <NotificationRow key={n.id} n={n} onOpen={(x) => !x.read && markRead.mutate(x.id)} />
        ))}
      </div>
      {feed.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage && <Loader2Icon className="animate-spin" />} Load more
          </Button>
        </div>
      )}
    </div>
  );
}

/** Mark-all for the page header: the newest notification shown is the cutoff (newer ones stay unread). */
export function LiveMarkAllButton({ unreadOnly }: { unreadOnly: boolean }) {
  const feed = useLiveNotificationFeed({ unread: unreadOnly, limit: 20 });
  const markAll = useLiveMarkAllRead();
  const newest = feed.data?.pages[0]?.items[0]?.createdAt;
  const hasUnread = feed.data?.pages.some((p) => p.items.some((n) => !n.read)) ?? false;
  return (
    <Button variant="outline" disabled={!hasUnread || !newest || markAll.isPending} onClick={() => newest && markAll.mutate(newest)}>
      <CheckCheckIcon /> Mark all read
    </Button>
  );
}

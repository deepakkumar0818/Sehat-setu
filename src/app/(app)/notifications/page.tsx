"use client";

import { useState } from "react";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationSource, useNotifications } from "@/hooks/use-notifications";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveMarkAllButton, LiveNotificationList, NotificationsUnavailable } from "@/components/notifications/live-notifications";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  appointment_reminder: "Appointment",
  report_available: "Report",
  payment_received: "Payment",
  prescription_created: "Prescription",
  low_stock: "Inventory",
  expiry_warning: "Inventory",
  ai_insight: "AI Insight",
  system: "System",
};

export default function NotificationsPage() {
  const source = useNotificationSource();
  if (source === "live") return <LiveNotificationsPage />;
  if (source === "unavailable") {
    return (
      <div className="space-y-5">
        <PageHeader title="Notifications" description="Appointment, inventory and team updates for your clinic." />
        <NotificationsUnavailable />
      </div>
    );
  }
  return <DemoNotificationsPage />;
}

function LiveNotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Appointment, inventory and team updates for your clinic. Refreshed every minute."
        actions={<LiveMarkAllButton unreadOnly={unreadOnly} />}
      />
      <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={(v) => setUnreadOnly(v === "unread")}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>
      </Tabs>
      <LiveNotificationList unreadOnly={unreadOnly} />
    </div>
  );
}

/** Demo mode only: fictional notifications from the in-browser store. */
function DemoNotificationsPage() {
  const user = useCurrentUser();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useNotifications({ role: user?.role, patientId: user?.patientId, page, pageSize: 20 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Stay on top of appointments, payments, and clinic alerts."
        actions={
          <Button variant="outline" onClick={() => markAllRead.mutate({ role: user?.role, patientId: user?.patientId })}>
            <CheckCheckIcon /> Mark all read
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={BellIcon} title="No notifications" description="You're all caught up." />
      ) : (
        <>
          <div className="divide-y overflow-hidden rounded-lg border">
            {data.items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read && markRead.mutate(n.id)}
                className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted", !n.read && "bg-accent/30")}
              >
                <div className="flex items-center gap-2">
                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  <Badge variant="outline" className="ml-auto shrink-0">{TYPE_LABELS[n.type] ?? n.type}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeTime(n.date)}</p>
              </button>
            ))}
          </div>
          <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>
        </>
      )}
    </div>
  );
}

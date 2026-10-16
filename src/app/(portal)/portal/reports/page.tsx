"use client";

import Link from "next/link";
import { FlaskConicalIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useReports } from "@/hooks/use-clinical";
import { useLiveData } from "@/lib/data-source";
import { LivePortalReports } from "@/components/portal/live-portal";

export default function PortalReportsPage() {
  // Live: only the patient's reviewed, shared reports (P6.3). Demo mode: the original mock list.
  return useLiveData() ? <LivePortalReports /> : <DemoPortalReportsPage />;
}

function DemoPortalReportsPage() {
  const user = useCurrentUser();
  const { data, isLoading } = useReports({ patientId: user?.patientId, pageSize: 50 });

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Your lab reports and diagnostic results." />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FlaskConicalIcon} title="No reports yet" description="Reports shared by your doctor will appear here." />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border">
          {data.items.map((r) => (
            <Link key={r.id} href={`/portal/reports/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

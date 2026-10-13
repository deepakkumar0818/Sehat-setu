"use client";

import { useRouter } from "next/navigation";
import { StethoscopeIcon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useConsultations } from "@/hooks/use-clinical";
import { useAppointments } from "@/hooks/use-appointments";
import { todayDateStr } from "@/lib/demo-clock";

export default function PortalConsultationsPage() {
  const router = useRouter();
  const user = useCurrentUser();
  const { data, isLoading } = useConsultations({ patientId: user?.patientId, pageSize: 50 });
  const { data: joinable } = useAppointments({ patientId: user?.patientId, type: "online", dateFrom: todayDateStr(), pageSize: 10 });
  const joinableAppts = (joinable?.items ?? []).filter((a) => ["upcoming", "waiting", "in_consultation"].includes(a.status));

  return (
    <div className="space-y-5">
      <PageHeader title="Consultations" description="Your consultation history and upcoming online sessions." />

      {joinableAppts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Ready to join</p>
          {joinableAppts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-primary/30 bg-accent/30 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{a.doctorName}</p>
                <p className="text-xs text-muted-foreground">{formatDate(a.date)} · {a.time}</p>
              </div>
              <Button size="sm" onClick={() => router.push(`/portal/consultation/${a.id}`)}><VideoIcon /> Join</Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">History</p>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : data && data.items.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {data.items.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{c.chiefComplaint}</p>
                  <p className="text-xs text-muted-foreground">{c.doctorName} · {formatDate(c.date)}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={StethoscopeIcon} title="No consultations yet" description="Your consultation history will appear here after your first visit." />
        )}
      </div>
    </div>
  );
}

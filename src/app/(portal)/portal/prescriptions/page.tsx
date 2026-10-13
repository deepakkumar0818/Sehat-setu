"use client";

import Link from "next/link";
import { FileSignatureIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePrescriptions } from "@/hooks/use-clinical";

export default function PortalPrescriptionsPage() {
  const user = useCurrentUser();
  const { data, isLoading } = usePrescriptions({ patientId: user?.patientId, pageSize: 50 });

  return (
    <div className="space-y-5">
      <PageHeader title="Prescriptions" description="Medicines prescribed by your doctors." />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FileSignatureIcon} title="No prescriptions yet" description="Prescriptions from your visits will appear here." />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border">
          {data.items.map((rx) => (
            <Link key={rx.id} href={`/portal/prescriptions/${rx.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{rx.items.map((i) => i.medicineName).join(", ")}</p>
                <p className="text-xs text-muted-foreground">{rx.doctorName} · {formatDate(rx.date)}</p>
              </div>
              <StatusBadge status={rx.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

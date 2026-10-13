import { PillIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { usePrescriptions } from "@/hooks/use-clinical";

export function MedicinesTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = usePrescriptions({ patientId, status: "active", pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} what="Medications" onRetry={() => refetch()} />;

  const rows = (data?.items ?? []).flatMap((rx) => rx.items.map((item) => ({ ...item, date: rx.date, doctorName: rx.doctorName, prescriptionId: rx.id })));

  if (rows.length === 0) {
    return <EmptyState icon={PillIcon} title="No active medications" description="Medicines from active prescriptions will appear here." />;
  }

  return (
    <div className="divide-y rounded-lg border">
      {rows.map((item, i) => (
        <div key={`${item.prescriptionId}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{item.medicineName} <span className="text-muted-foreground">{item.strength}</span></p>
            <p className="text-xs text-muted-foreground">{item.dosage} · {item.frequency} · {item.duration}</p>
            <p className="text-xs text-muted-foreground">Prescribed by {item.doctorName} on {formatDate(item.date)}</p>
          </div>
          <Badge variant="outline" className="border-success/30 text-success">Active</Badge>
        </div>
      ))}
    </div>
  );
}

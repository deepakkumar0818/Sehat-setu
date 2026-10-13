import Link from "next/link";
import { FileSignatureIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { usePrescriptions } from "@/hooks/use-clinical";

export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = usePrescriptions({ patientId, pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} what="Prescriptions" onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={FileSignatureIcon} title="No prescriptions yet" description="Prescriptions created for this patient will appear here." />;
  }

  return (
    <div className="divide-y rounded-lg border">
      {data.items.map((rx) => (
        <Link key={rx.id} href={`/prescriptions/${rx.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{rx.items.map((i) => i.medicineName).join(", ")}</p>
            <p className="text-xs text-muted-foreground">{[rx.prescriptionNumber, formatDate(rx.date), rx.doctorName].filter(Boolean).join(" · ")}</p>
          </div>
          <StatusBadge status={rx.status} />
        </Link>
      ))}
    </div>
  );
}

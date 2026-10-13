import Link from "next/link";
import { StethoscopeIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useConsultations } from "@/hooks/use-clinical";

export function ConsultationsTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useConsultations({ patientId, pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} what="Consultations" onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={StethoscopeIcon} title="No consultations yet" description="Consultations for this patient will appear here." />;
  }

  return (
    <div className="divide-y rounded-lg border">
      {data.items.map((c) => (
        <Link key={c.id} href={`/consultations/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{c.chiefComplaint}</p>
            <p className="text-xs text-muted-foreground">{formatDate(c.date)} · {c.doctorName}</p>
          </div>
          <StatusBadge status={c.status} />
        </Link>
      ))}
    </div>
  );
}

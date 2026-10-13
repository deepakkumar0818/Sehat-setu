import Link from "next/link";
import { FlaskConicalIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useReports } from "@/hooks/use-clinical";

export function ReportsTab({ patientId }: { patientId: string }) {
  const { data, isLoading } = useReports({ patientId, pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={FlaskConicalIcon} title="No lab reports yet" description="Uploaded or ordered reports for this patient will appear here." />;
  }

  return (
    <div className="divide-y rounded-lg border">
      {data.items.map((r) => (
        <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
            <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
          </div>
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </div>
  );
}

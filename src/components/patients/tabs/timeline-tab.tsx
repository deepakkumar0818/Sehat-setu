import { Timeline } from "@/components/shared/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { usePatientTimeline } from "@/hooks/use-patients";

export function TimelineTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = usePatientTimeline(patientId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) return <QueryError error={error} what="Timeline events" onRetry={() => refetch()} />;

  if (!data || data.length === 0) {
    return <EmptyState title="No timeline events yet" description="Consultations, prescriptions, reports, and invoices will appear here." />;
  }

  return <Timeline events={data} />;
}

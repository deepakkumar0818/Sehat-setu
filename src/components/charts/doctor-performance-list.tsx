import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatCurrency } from "@/lib/format";
import type { DoctorPerformanceRow } from "@/services/analytics";
import { useDataStore } from "@/store/data-store";

function useAvatarColor(doctorId: string): string {
  return useDataStore((s) => s.db.doctors.find((d) => d.id === doctorId)?.avatarColor ?? "var(--chart-1)");
}

function Row({ row, maxAppointments }: { row: DoctorPerformanceRow; maxAppointments: number }) {
  const color = useAvatarColor(row.doctorId);
  const widthPct = maxAppointments ? Math.max(6, Math.round((row.appointments / maxAppointments) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <PersonAvatar name={row.name} color={color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
          <p className="shrink-0 text-xs text-muted-foreground">{row.appointments} appts</p>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: color }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span>{row.completed} completed</span>
          <span>{row.followUps} follow-ups</span>
          <span className="font-medium text-foreground">{formatCurrency(row.revenue)}</span>
        </div>
      </div>
    </div>
  );
}

export function DoctorPerformanceList({ data, isLoading }: { data?: DoctorPerformanceRow[]; isLoading?: boolean }) {
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const maxAppointments = Math.max(...data.map((d) => d.appointments), 1);

  return (
    <div className="divide-y">
      {data.slice(0, 8).map((row) => (
        <Row key={row.doctorId} row={row} maxAppointments={maxAppointments} />
      ))}
    </div>
  );
}

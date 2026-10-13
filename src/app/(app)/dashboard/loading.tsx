import { Skeleton } from "@/components/ui/skeleton";

/** Dashboard skeleton: mirrors the stat grid, chart, and table layout. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[340px] w-full rounded-xl xl:col-span-2" />
        <Skeleton className="h-[340px] w-full rounded-xl" />
      </div>
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  );
}

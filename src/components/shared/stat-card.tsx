import type { LucideIcon } from "lucide-react";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  trend?: { value: number; label?: string };
  tone?: "default" | "warning" | "danger";
  isLoading?: boolean;
  className?: string;
}

const TONE_ICON_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-accent text-primary",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
};

export function StatCard({ label, value, icon: Icon, trend, tone = "default", isLoading, className }: StatCardProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="flex items-center justify-between gap-4 py-2">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {trend && (
            <div className={cn("mt-1.5 flex items-center gap-1 text-xs font-medium", trend.value >= 0 ? "text-success" : "text-danger")}>
              {trend.value >= 0 ? <ArrowUpRightIcon className="h-3.5 w-3.5" /> : <ArrowDownRightIcon className="h-3.5 w-3.5" />}
              <span>{Math.abs(trend.value)}%</span>
              {trend.label && <span className="font-normal text-muted-foreground">{trend.label}</span>}
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", TONE_ICON_CLASSES[tone])}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

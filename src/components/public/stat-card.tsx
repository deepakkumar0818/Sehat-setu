import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "primary" | "warning" | "info" | "success";
  className?: string;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/15 text-primary",
  warning: "bg-warning-muted text-warning",
  info: "bg-info-muted text-info",
  success: "bg-success-muted text-success",
};

export function StatCard({ icon: Icon, label, value, tone = "primary", className }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", TONE_CLASSES[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

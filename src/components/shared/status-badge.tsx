import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary" | "ai";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning border-warning/20",
  danger: "bg-danger-muted text-danger border-danger/20",
  info: "bg-info-muted text-info border-info/20",
  neutral: "bg-muted text-muted-foreground border-transparent",
  primary: "bg-accent text-primary border-primary/20",
  ai: "bg-ai-muted text-ai border-ai/20",
};

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  // appointments / consultations
  upcoming: "info",
  scheduled: "info",
  confirmed: "primary",
  checked_in: "warning",
  waiting: "warning",
  in_consultation: "primary",
  completed: "success",
  cancelled: "neutral",
  no_show: "danger",
  in_progress: "primary",
  // payments / invoices
  paid: "success",
  partial: "warning",
  partially_paid: "warning",
  pending: "warning",
  refunded: "neutral",
  success: "success",
  failed: "danger",
  // prescriptions
  active: "success",
  // inventory
  in_stock: "success",
  low_stock: "warning",
  out_of_stock: "danger",
  expiring_soon: "warning",
  expired: "danger",
  // reports
  available: "success",
  // people
  inactive: "neutral",
  on_leave: "warning",
  archived: "neutral",
};

function formatLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface StatusBadgeProps {
  status: string;
  tone?: StatusTone;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, tone, label, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? STATUS_TONE_MAP[status] ?? "neutral";
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 font-medium capitalize", TONE_CLASSES[resolvedTone], className)}>
      {label ?? formatLabel(status)}
    </Badge>
  );
}

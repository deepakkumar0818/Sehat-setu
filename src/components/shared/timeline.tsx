import Link from "next/link";
import { CalendarIcon, FileTextIcon, FlaskConicalIcon, ReceiptIcon, StethoscopeIcon, type LucideIcon } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { TimelineEvent } from "@/types";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<TimelineEvent["type"], LucideIcon> = {
  consultation: StethoscopeIcon,
  report: FlaskConicalIcon,
  prescription: FileTextIcon,
  appointment: CalendarIcon,
  invoice: ReceiptIcon,
};

const TYPE_COLOR: Record<TimelineEvent["type"], string> = {
  consultation: "bg-primary/10 text-primary",
  report: "bg-info-muted text-info",
  prescription: "bg-secondary/10 text-secondary",
  appointment: "bg-warning-muted text-warning",
  invoice: "bg-success-muted text-success",
};

export function Timeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-5 border-l pl-6", className)}>
      {events.map((event) => {
        const Icon = TYPE_ICON[event.type];
        return (
          <li key={event.id} className="relative">
            <span
              className={cn(
                "absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background",
                TYPE_COLOR[event.type]
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <Link href={event.href} className="block rounded-md px-2 py-1 -mx-2 hover:bg-muted">
              <p className="text-xs text-muted-foreground">{formatDate(event.date)}</p>
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              {event.subtitle && <p className="text-sm text-muted-foreground">{event.subtitle}</p>}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

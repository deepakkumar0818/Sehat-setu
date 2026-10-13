"use client";

import { eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { useAppNow } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import type { AppointmentWithNames } from "@/services/appointments";

interface MonthGridProps {
  month: Date;
  appointments: AppointmentWithNames[];
  onSelectDay: (date: Date) => void;
}

export function MonthGrid({ month, appointments, onSelectDay }: MonthGridProps) {
  const today = useAppNow();
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const countByDate = new Map<string, number>();
  for (const a of appointments) {
    countByDate.set(a.date, (countByDate.get(a.date) ?? 0) + 1);
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const count = countByDate.get(iso) ?? 0;
          const inMonth = isSameMonth(day, month);
          return (
            <button
              key={iso}
              onClick={() => onSelectDay(day)}
              className={cn(
                "flex h-20 flex-col items-start gap-1 border-b border-r p-1.5 text-left last:border-r-0 hover:bg-muted/60",
                !inMonth && "bg-muted/20 text-muted-foreground/50"
              )}
            >
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-xs", isSameDay(day, today) && "bg-primary text-primary-foreground")}>
                {format(day, "d")}
              </span>
              {count > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {count} appt{count > 1 ? "s" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

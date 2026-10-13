"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppointmentStatusCount } from "@/services/analytics";

const STATUS_COLOR: Record<string, string> = {
  completed: "var(--success)",
  waiting: "var(--warning)",
  upcoming: "var(--info)",
  scheduled: "var(--info)",
  confirmed: "var(--chart-2)",
  checked_in: "var(--warning)",
  in_consultation: "var(--chart-4)",
  cancelled: "var(--muted-foreground)",
  no_show: "var(--danger)",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  waiting: "Waiting",
  upcoming: "Upcoming",
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_consultation: "In consultation",
  cancelled: "Cancelled",
  no_show: "No-show",
};

const chartConfig: ChartConfig = {
  count: { label: "Appointments" },
};

export function AppointmentStatusChart({ data, isLoading }: { data?: AppointmentStatusCount[]; isLoading?: boolean }) {
  if (isLoading || !data) return <Skeleton className="h-[260px] w-full" />;

  const rows = data.map((d) => ({ ...d, label: STATUS_LABEL[d.status] ?? d.status }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 8 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={90} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" radius={4} barSize={22}>
          {rows.map((row) => (
            <Cell key={row.status} fill={STATUS_COLOR[row.status] ?? "var(--muted-foreground)"} />
          ))}
          <LabelList dataKey="count" position="right" className="fill-foreground text-xs font-medium" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

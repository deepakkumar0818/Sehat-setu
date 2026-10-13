"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { PatientGrowthPoint } from "@/services/analytics";

const chartConfig: ChartConfig = {
  new: { label: "New patients", color: "var(--chart-1)" },
  returning: { label: "Returning patients", color: "var(--chart-2)" },
};

export function PatientGrowthChart({ data, isLoading }: { data?: PatientGrowthPoint[]; isLoading?: boolean }) {
  if (isLoading || !data) return <Skeleton className="h-[260px] w-full" />;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={(value: string) => formatDate(value, "dd MMM")} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent labelFormatter={(value) => formatDate(String(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="new" stackId="visits" fill="var(--chart-1)" radius={[0, 0, 2, 2]} />
        <Bar dataKey="returning" stackId="visits" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

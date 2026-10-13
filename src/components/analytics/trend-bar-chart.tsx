"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

/** Bars per day (yyyy-MM-dd) or per month (yyyy-MM) for one or more series. */
export function TrendBarChart({
  data,
  xKey,
  series,
  stacked,
  isLoading,
  formatValue = (v) => v.toLocaleString("en-IN"),
}: {
  data?: object[];
  xKey: "date" | "month";
  series: TrendSeries[];
  stacked?: boolean;
  isLoading?: boolean;
  formatValue?: (value: number) => string;
}) {
  if (isLoading || !data) return <Skeleton className="h-[260px] w-full" />;
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
  const tick = (value: string) => (xKey === "month" ? formatDate(`${value}-01`, "MMM yyyy") : formatDate(value, "dd MMM"));
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tick} />
        <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={(v: number) => formatValue(v)} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(value) => (xKey === "month" ? formatDate(`${value}-01`, "MMMM yyyy") : formatDate(String(value)))} formatter={(value, name) => [formatValue(Number(value)), ` ${config[String(name)]?.label ?? name}`]} />}
        />
        {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} stackId={stacked ? "a" : undefined} radius={stacked && i < series.length - 1 ? 0 : [3, 3, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

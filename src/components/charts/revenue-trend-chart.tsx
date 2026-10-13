"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatDate } from "@/lib/format";
import type { RevenueTrendPoint } from "@/services/analytics";

const chartConfig: ChartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
};

export function RevenueTrendChart({ data, isLoading }: { data?: RevenueTrendPoint[]; isLoading?: boolean }) {
  if (isLoading || !data) return <Skeleton className="h-[260px] w-full" />;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={(value: string) => formatDate(value, "dd MMM")}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDate(String(value))}
              formatter={(value) => [`₹${formatCompactNumber(Number(value))}`, " Revenue"]}
            />
          }
        />
        <Area dataKey="revenue" type="monotone" fill="url(#revenueFill)" stroke="var(--chart-1)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}

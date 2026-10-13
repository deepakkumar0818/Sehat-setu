"use client";

import { CheckCircle2Icon, MinusCircleIcon, XCircleIcon } from "lucide-react";
import { AIPanel } from "@/components/shared/ai-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useClinicInsights } from "@/hooks/use-analytics";
import { cn } from "@/lib/utils";

const TONE_ICON = { positive: CheckCircle2Icon, negative: XCircleIcon, neutral: MinusCircleIcon };
const TONE_CLASS = { positive: "text-success", negative: "text-danger", neutral: "text-muted-foreground" };

export function AIInsightsPanel({ className }: { className?: string }) {
  const { data, isLoading } = useClinicInsights();

  return (
    <AIPanel title="AI Insights" className={className} disclaimer="Generated from current clinic data — verify before acting.">
      {isLoading || !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {data.map((insight) => {
            const Icon = TONE_ICON[insight.tone];
            return (
              <li key={insight.id} className="flex items-start gap-2 text-sm">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_CLASS[insight.tone])} />
                <span className="text-foreground">{insight.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </AIPanel>
  );
}

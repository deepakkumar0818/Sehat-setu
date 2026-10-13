import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function AIBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-ai-muted px-2 py-0.5 text-[11px] font-medium text-ai", className)}>
      <SparklesIcon className="h-3 w-3" />
      AI-generated
    </span>
  );
}

interface AIPanelProps {
  title: string;
  children: React.ReactNode;
  disclaimer?: string;
  className?: string;
  actions?: React.ReactNode;
}

export function AIPanel({ title, children, disclaimer = "Review before clinical use.", className, actions }: AIPanelProps) {
  return (
    <div className={cn("rounded-lg border border-ai/20 bg-ai-muted/40 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ai/15 text-ai">
            <SparklesIcon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {actions}
      </div>
      <div className="mt-3 space-y-3 text-sm text-foreground">{children}</div>
      <p className="mt-3 border-t border-ai/15 pt-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-ai">AI-generated</span> · {disclaimer}
      </p>
    </div>
  );
}

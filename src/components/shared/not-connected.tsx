import { DatabaseZapIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

/**
 * Shown in the live (database-backed) staff app wherever a feature's database
 * version isn't built yet — instead of silently showing demo data or an empty list.
 */
export function NotConnected({ feature, className }: { feature: string; className?: string }) {
  return (
    <EmptyState
      icon={DatabaseZapIcon}
      title={`${feature} isn't connected yet`}
      description="This part of Sehat Setu doesn't read your clinic database yet. It's coming in a later phase."
      className={cn("py-10", className)}
    />
  );
}

/** Thin page-level notice for staff pages that still show fictional demo data in live mode. */
export function DemoDataNotice() {
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning print:hidden">
      <DatabaseZapIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Demo data.</strong> This page isn&apos;t connected to your clinic database yet — everything shown here is fictional sample data stored in this browser.
      </span>
    </div>
  );
}

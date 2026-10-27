"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { usePlatformActivity } from "@/hooks/use-platform";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HistoryIcon } from "lucide-react";
import type { PlatformActivityEvent, PlatformActivityKind, PlatformClinic, PlatformSubscription, SubscriptionPaymentMethod } from "@/lib/live-types";

// Pieces shared by the super admin console's pages.

export const CLINIC_STATUS_TEXT: Record<PlatformClinic["status"], string> = { active: "Active", suspended: "Suspended", pending: "Pending" };

export function ClinicStatusBadge({ status }: { status: PlatformClinic["status"] }) {
  return (
    <Badge variant="outline" className={status === "active" ? "border-success/40 text-success" : "border-danger/40 text-danger"}>
      {CLINIC_STATUS_TEXT[status]}
    </Badge>
  );
}

const STATE_STYLE: Record<PlatformSubscription["state"], [string, string]> = {
  trial: ["Free trial", "border-info/40 text-info"],
  active: ["Paid", "border-success/40 text-success"],
  due_soon: ["Due soon", "border-warning/40 text-warning"],
  overdue: ["Overdue", "border-danger/40 text-danger"],
};

/** "Paid", "Due soon", "Overdue" or "Free trial"; "No plan" without a subscription. */
export function SubscriptionBadge({ subscription }: { subscription: PlatformSubscription | null }) {
  if (!subscription) return <Badge variant="outline" className="text-muted-foreground">No plan</Badge>;
  const [label, style] = STATE_STYLE[subscription.state];
  return <Badge variant="outline" className={style}>{label}</Badge>;
}

/** "Paid until 12 Dec 2026 · 46 days left" / "Overdue by 3 days". */
export function paidUntilText(s: PlatformSubscription): string {
  const date = formatDate(s.paidUntil);
  if (s.daysLeft < 0) return `Ended ${date} · overdue by ${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"}`;
  if (s.daysLeft === 0) return `Until ${date} · ends today`;
  return `Until ${date} · ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`;
}

export const priceText = (s: Pick<PlatformSubscription, "price" | "billingCycle">) =>
  s.price === 0 ? "Free" : `${formatCurrency(s.price)} / ${s.billingCycle === "yearly" ? "year" : "month"}`;

export const PAYMENT_METHODS: Record<SubscriptionPaymentMethod, string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

export const limitText = (n: number | null) => (n === null ? "Unlimited" : String(n));

/** "3 / 5" usage against a plan limit, red once at or over it. */
export function LimitMeter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max === null ? 0 : Math.min(100, Math.round((used / max) * 100));
  const full = max !== null && used >= max;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", full ? "text-danger" : "text-foreground")}>
          {used} / {limitText(max)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", full ? "bg-danger" : "bg-primary")} style={{ width: max === null ? "8%" : `${pct}%` }} />
      </div>
    </div>
  );
}

// --- Activity ---------------------------------------------------------------

const PLATFORM_ACTIONS: Record<string, string> = {
  "platform.clinic_created": "Added the clinic",
  "platform.clinic_updated": "Edited the clinic's details",
  "platform.clinic_suspended": "Suspended the clinic",
  "platform.clinic_activated": "Reactivated the clinic",
  "platform.clinic_auto_suspended": "Clinic suspended automatically (payment overdue)",
  "platform.admin_added": "Added an administrator",
  "platform.admin_removed": "Removed an administrator",
  "platform.admin_granted": "Made someone a super admin",
  "platform.subscription_updated": "Changed the plan / subscription",
  "platform.subscription_payment_recorded": "Recorded a payment",
  "platform.subscription_payment_voided": "Voided a payment",
  "platform.plan_created": "Created a plan",
  "platform.plan_updated": "Edited a plan",
};

const OTHER_ACTIONS: Record<string, string> = {
  "access.denied": "Was refused access",
  "auth.account_linked": "Signed in for the first time",
  "auth.password_changed": "Changed their password",
  "patient.self_register_failed": "Patient sign-up failed",
  "patient.link_code_redeem_failed": "Patient link code failed",
  "patient.email_link_failed": "Patient email link failed",
  "document.upload_failed": "Document upload failed",
  "staff.invitation_delivery_failed": "Staff invitation email failed",
  "patient_intake.access_denied": "Was refused a patient intake form",
};

function eventText(e: PlatformActivityEvent): string {
  const known = PLATFORM_ACTIONS[e.action] ?? OTHER_ACTIONS[e.action];
  if (known) return known;
  const [area, op] = e.action.split(".");
  return `${(op ?? area).replaceAll("_", " ")} (${area.replaceAll("_", " ")})`.replace(/^./, (c) => c.toUpperCase());
}

function eventDetail(e: PlatformActivityEvent): string | null {
  const m = e.metadata;
  if (!m) return e.reason;
  const parts: string[] = [];
  if (typeof m.amountPaise === "number") parts.push(formatCurrency(m.amountPaise / 100));
  if (typeof m.months === "number") parts.push(`${m.months} month${m.months === 1 ? "" : "s"}`);
  if (typeof m.paidUntil === "string") parts.push(`paid until ${formatDate(m.paidUntil)}`);
  if (Array.isArray(m.fields)) parts.push(`changed ${m.fields.join(", ")}`);
  if (typeof m.code === "string") parts.push(m.code);
  if (m.reason === "payment") parts.push("after payment");
  return parts.length ? parts.join(" · ") : null;
}

/** The activity log (all clinics, or one), newest first, with "Load older". */
export function ActivityList({ clinicId, kind, showClinic = true }: { clinicId?: string; kind: PlatformActivityKind; showClinic?: boolean }) {
  const query = usePlatformActivity({ clinicId, kind });
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  if (query.isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (query.error) return <QueryError error={query.error} what="Activity" onRetry={() => query.refetch()} />;
  if (events.length === 0) return <EmptyState icon={HistoryIcon} title="Nothing here yet" description="Actions and problems will show up here." />;
  return (
    <div className="space-y-3">
      <ol className="divide-y rounded-xl border bg-card">
        {events.map((e) => {
          const detail = eventDetail(e);
          const problem = e.outcome !== "success";
          return (
            <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{e.actorName ?? e.actorLabel ?? "System"}</span>{" "}
                  <span className={problem ? "text-danger" : undefined}>{eventText(e).replace(/^./, (c) => c.toLowerCase())}</span>
                  {problem && <Badge variant="outline" className="ml-2 border-danger/40 text-danger">{e.outcome === "denied" ? "Denied" : "Failed"}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[showClinic && e.clinicName ? `${e.clinicName} (${e.clinicCode})` : null, detail, e.actorEmail].filter(Boolean).join(" · ")}
                </p>
              </div>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
            </li>
          );
        })}
      </ol>
      {query.hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? "Loading…" : "Load older"}
        </Button>
      )}
    </div>
  );
}

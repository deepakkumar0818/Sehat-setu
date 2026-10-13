"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { CURRENT_PLAN_ID, SUBSCRIPTION_INVOICES, SUBSCRIPTION_PLANS } from "@/lib/subscription-data";
import { useDataStore } from "@/store/data-store";
import { cn } from "@/lib/utils";

export default function SubscriptionPage() {
  const branches = useDataStore((s) => s.db.branches);
  const staffCount = useDataStore((s) => s.db.staff.length + s.db.doctors.length);
  const [planId, setPlanId] = useState(CURRENT_PLAN_ID);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const currentPlan = SUBSCRIPTION_PLANS.find((p) => p.id === planId)!;

  return (
    <div className="space-y-5">
      <PageHeader title="Subscription" description="Manage your Sehat Setu platform subscription and billing." />

      <Card>
        <CardHeader><CardTitle>Current plan</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-foreground">{currentPlan.name}</p>
              <p className="text-sm text-muted-foreground">
                {currentPlan.priceMonthly > 0 ? `${formatCurrency(currentPlan.priceMonthly)} / month` : "Custom pricing"} · Billed monthly
              </p>
            </div>
            <Badge variant="outline" className="border-success/30 text-success">Active</Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Branches used</span>
                <span className="font-medium text-foreground">{branches.length} / {currentPlan.branchLimit === Infinity ? "∞" : currentPlan.branchLimit}</span>
              </div>
              <Progress value={currentPlan.branchLimit === Infinity ? 10 : (branches.length / currentPlan.branchLimit) * 100} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Staff accounts used</span>
                <span className="font-medium text-foreground">{staffCount} / {currentPlan.userLimit === Infinity ? "∞" : currentPlan.userLimit}</span>
              </div>
              <Progress value={currentPlan.userLimit === Infinity ? 10 : (staffCount / currentPlan.userLimit) * 100} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <Card key={plan.id} className={cn(plan.id === planId && "border-primary ring-1 ring-primary")}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {plan.name}
                {plan.id === planId && <Badge>Current</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-2xl font-semibold text-foreground">
                {plan.priceMonthly > 0 ? formatCurrency(plan.priceMonthly) : "Custom"}
                {plan.priceMonthly > 0 && <span className="text-sm font-normal text-muted-foreground">/month</span>}
              </p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5"><CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> {f}</li>
                ))}
              </ul>
              <Button
                variant={plan.id === planId ? "outline" : "default"}
                className="w-full"
                disabled={plan.id === planId}
                onClick={() => setPendingPlan(plan.id)}
              >
                {plan.id === planId ? "Current plan" : SUBSCRIPTION_PLANS.findIndex((p) => p.id === plan.id) > SUBSCRIPTION_PLANS.findIndex((p) => p.id === planId) ? "Upgrade" : "Downgrade"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice history</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {SUBSCRIPTION_INVOICES.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-6 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{inv.id}</p>
                <p className="text-xs text-muted-foreground">{formatDate(inv.date)} · {inv.planName}</p>
              </div>
              <div className="flex items-center gap-3">
                <span>{formatCurrency(inv.amount)}</span>
                <StatusBadge status={inv.status} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingPlan)}
        onOpenChange={(open) => !open && setPendingPlan(null)}
        title={`Switch to ${SUBSCRIPTION_PLANS.find((p) => p.id === pendingPlan)?.name}?`}
        description="Your plan change will take effect at the start of your next billing cycle."
        confirmLabel="Confirm change"
        onConfirm={() => {
          if (pendingPlan) setPlanId(pendingPlan);
          setPendingPlan(null);
          toast.success("Subscription plan updated.");
        }}
      />
    </div>
  );
}

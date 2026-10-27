"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LayersIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { usePlatformPlans, useSavePlatformPlan } from "@/hooks/use-platform";
import { formatCurrency } from "@/lib/format";
import type { PlatformPlan } from "@/lib/live-types";
import { limitText } from "./platform-shared";

// The plans clinics can be on: prices and limits. Changing a plan's price
// doesn't change what existing clinics pay (each has its own agreed price);
// changing a limit applies to every clinic on the plan from now on.

export function PlatformPlans() {
  const query = usePlatformPlans();
  const [editing, setEditing] = useState<PlatformPlan | "new" | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans"
        description="What clinics pay and how big they can grow. Each clinic's own agreed price is set on its page."
        actions={<Button onClick={() => setEditing("new")}><PlusIcon /> New plan</Button>}
      />
      {query.isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : query.error ? (
        <QueryError error={query.error} what="Plans" onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState icon={LayersIcon} title="No plans" description="Create the first plan." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Yearly</TableHead>
                <TableHead className="text-right">Branches</TableHead>
                <TableHead className="text-right">Doctors</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead className="text-right">Clinics on it</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((p) => (
                <TableRow key={p.id} className={p.isActive ? undefined : "opacity-60"}>
                  <TableCell>
                    <p className="font-medium text-foreground">
                      {p.name} {!p.isActive && <Badge variant="outline" className="ml-1 text-muted-foreground">Retired</Badge>}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{p.key}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.monthlyPrice === 0 ? "Free" : formatCurrency(p.monthlyPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.yearlyPrice === 0 ? "Free" : formatCurrency(p.yearlyPrice)}
                    {p.monthlyPrice > 0 && p.yearlyPrice > 0 && p.yearlyPrice < p.monthlyPrice * 12 && (
                      <span className="block text-xs text-success">saves {Math.round((1 - p.yearlyPrice / (p.monthlyPrice * 12)) * 100)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{limitText(p.maxBranches)}</TableCell>
                  <TableCell className="text-right">{limitText(p.maxDoctors)}</TableCell>
                  <TableCell className="text-right">{limitText(p.maxStaff)}</TableCell>
                  <TableCell className="text-right">{p.clinics}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)}><PencilIcon /> Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The free trial is the plan every new clinic starts on, for 30 days. Retired plans can&apos;t be chosen for new subscriptions; clinics already on one keep it.
      </p>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function PlanDialog({ plan, onClose }: { plan: PlatformPlan | null; onClose: () => void }) {
  const save = useSavePlatformPlan();
  const [key, setKey] = useState(plan?.key ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [monthly, setMonthly] = useState(plan ? String(plan.monthlyPrice) : "");
  const [yearly, setYearly] = useState(plan ? String(plan.yearlyPrice) : "");
  const [branches, setBranches] = useState(plan?.maxBranches == null ? "" : String(plan.maxBranches));
  const [doctors, setDoctors] = useState(plan?.maxDoctors == null ? "" : String(plan.maxDoctors));
  const [staff, setStaff] = useState(plan?.maxStaff == null ? "" : String(plan.maxStaff));
  const [active, setActive] = useState(plan?.isActive ?? true);

  const price = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
  const lim = (v: string) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= 1);
  const keyOk = plan !== null || /^[A-Z][A-Z0-9_]{1,29}$/.test(key.trim().toUpperCase());
  const valid = keyOk && name.trim().length >= 2 && price(monthly) && price(yearly) && lim(branches) && lim(doctors) && lim(staff);

  const limitField = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={1} placeholder="Unlimited" value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
          <DialogDescription>
            {plan && plan.clinics > 0
              ? `${plan.clinics} clinic${plan.clinics === 1 ? " is" : "s are"} on this plan. New limits apply to them straight away; what each pays doesn't change.`
              : "Leave a limit empty for unlimited."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                id: plan?.id ?? null,
                input: {
                  key: plan ? undefined : key.trim().toUpperCase(),
                  name: name.trim(),
                  monthlyPrice: Number(monthly),
                  yearlyPrice: Number(yearly),
                  maxBranches: num(branches),
                  maxDoctors: num(doctors),
                  maxStaff: num(staff),
                  isActive: active,
                },
              },
              { onSuccess: () => { toast.success(plan ? "Plan saved." : "Plan created."); onClose(); } }
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input id="plan-name" maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-key">Key</Label>
              <Input id="plan-key" maxLength={30} className="font-mono uppercase" value={key} disabled={plan !== null} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="e.g. PRO" />
              {plan === null && <p className="text-xs text-muted-foreground">Can&apos;t be changed later.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-monthly">Price per month (₹)</Label>
              <Input id="plan-monthly" type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-yearly">Price per year (₹)</Label>
              <Input id="plan-yearly" type="number" min={0} value={yearly} onChange={(e) => setYearly(e.target.value)} />
            </div>
            {limitField("plan-branches", "Max branches", branches, setBranches)}
            {limitField("plan-doctors", "Max doctors", doctors, setDoctors)}
            {limitField("plan-staff", "Max staff (incl. doctors)", staff, setStaff)}
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="plan-active">Available for new subscriptions</Label>
              <p className="text-xs text-muted-foreground">Turn off to retire it. Clinics already on it keep it.</p>
            </div>
            <Switch id="plan-active" checked={active} onCheckedChange={setActive} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !valid}>{save.isPending ? "Saving…" : plan ? "Save" : "Create plan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

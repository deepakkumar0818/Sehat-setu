"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  DownloadIcon,
  IndianRupeeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RepeatIcon,
  UsersIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { useCreatePlatformClinic, usePlatformOverview, useSetPlatformClinicStatus } from "@/hooks/use-platform";
import { formatCurrency, formatDate, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformClinic, PlatformClinicInput } from "@/lib/live-types";
import { clinicAlerts, clinicsCsv, limitsReached, sortClinics, type AlertTone, type ClinicAlert, type ClinicSort } from "@/lib/platform-insights";
import { ClinicStatusBadge, SubscriptionBadge, priceText } from "./platform-shared";
import { CopyClinicJoinLinkButton } from "@/components/shared/clinic-join-link";

// The super admin console: every clinic on Sehat Setu, what needs attention
// (no administrator, payment overdue, trial ending, at a plan limit, unused),
// each clinic's plan and usage, adding a clinic, exporting the list, and
// suspending or reactivating one. A clinic's page has its plan, payments,
// people and administrators. Counts only: no patient, clinical or billing
// records are shown here.

type Filter = "all" | "attention" | "overdue" | "due_soon" | "trial" | "suspended";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "overdue", label: "Payment overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "trial", label: "On free trial" },
  { value: "suspended", label: "Suspended" },
];
const SORTS: { value: ClinicSort; label: string }[] = [
  { value: "attention", label: "Needs attention first" },
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name (A–Z)" },
  { value: "paid_until", label: "Paid-until (soonest)" },
  { value: "appointments", label: "Most appointments" },
];
const urgent = (a: ClinicAlert) => a.tone !== "info";
const matches = (c: PlatformClinic, f: Filter) =>
  f === "all" ||
  (f === "attention" ? clinicAlerts(c).some(urgent) : f === "suspended" ? c.status === "suspended" : c.status === "active" && c.subscription?.state === f);

/** The clinic's page, opening one of its dialogs ("payment", "plan", "admin", "edit"). */
const clinicHref = (id: string, action?: string) => `/platform/clinics/${id}${action && action !== "open" ? `?do=${action}` : ""}`;

const TONE_DOT: Record<AlertTone, string> = { danger: "bg-danger", warning: "bg-warning", info: "bg-info" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function PlatformConsole() {
  const query = usePlatformOverview();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<ClinicSort>("attention");
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<PlatformClinic | null>(null);
  const setStatus = useSetPlatformClinicStatus();
  const data = query.data;
  const all = useMemo(() => data?.clinics ?? [], [data]);
  const q = search.trim().toLowerCase();
  const clinics = sortClinics(
    all.filter((c) => matches(c, filter) && (!q || [c.name, c.code, c.city, c.email, ...c.admins.map((a) => a.email)].some((v) => v.toLowerCase().includes(q)))),
    sort
  );
  const attention = all.flatMap((c) => clinicAlerts(c).map((a) => ({ clinic: c, alert: a })));
  const needAttention = new Set(attention.filter((x) => urgent(x.alert)).map((x) => x.clinic.id)).size;
  const autoSuspended = data?.autoSuspended ?? 0;
  useEffect(() => {
    if (autoSuspended > 0) toast.warning(`${autoSuspended} clinic${autoSuspended === 1 ? " was" : "s were"} suspended automatically: payment overdue past the grace days.`);
  }, [autoSuspended]);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(["﻿" + clinicsCsv(clinics)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sehat-setu-clinics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="All clinics"
        description="Every clinic on Sehat Setu: what needs your attention, what each pays, and how much it's used."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!clinics.length}><DownloadIcon /> Export</Button>
            <Button onClick={() => setAdding(true)}><PlusIcon /> Add clinic</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Clinics" value={data ? `${data.totals.activeClinics} active of ${data.totals.clinics}` : "—"} icon={Building2Icon} isLoading={query.isLoading} />
        <StatCard
          label="Need attention"
          value={data ? String(needAttention) : "—"}
          icon={AlertTriangleIcon}
          tone={attention.some((x) => x.alert.tone === "danger") ? "danger" : needAttention > 0 ? "warning" : "default"}
          isLoading={query.isLoading}
        />
        <StatCard label="Monthly recurring revenue" value={data ? formatCurrency(data.totals.mrr) : "—"} icon={RepeatIcon} isLoading={query.isLoading} />
        <StatCard label="Received from clinics this month" value={data ? formatCurrency(data.totals.subscriptionCollectedThisMonth) : "—"} icon={IndianRupeeIcon} isLoading={query.isLoading} />
        <StatCard label="Patients (all clinics)" value={data ? String(data.totals.patients) : "—"} icon={UsersIcon} isLoading={query.isLoading} />
        <StatCard label="Appointments this month" value={data ? String(data.totals.appointmentsThisMonth) : "—"} icon={CalendarDaysIcon} isLoading={query.isLoading} />
      </div>

      {data && <AttentionPanel items={attention} />}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clinic, code, city or admin email..." className="lg:w-72" />
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
            {FILTERS.map((f) => {
              const n = f.value === "all" ? null : all.filter((c) => matches(c, f.value)).length;
              return (
                <Button
                  key={f.value}
                  size="sm"
                  variant={filter === f.value ? "secondary" : "ghost"}
                  aria-pressed={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn("h-8", (f.value === "overdue" || f.value === "attention") && n ? "text-danger" : undefined)}
                >
                  {f.label}
                  {n !== null && <span className="ml-1 tabular-nums text-muted-foreground">{n}</span>}
                </Button>
              );
            })}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as ClinicSort)}>
            <SelectTrigger className="h-8 w-48" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : query.error ? (
        <QueryError error={query.error} what="Clinics" onRetry={() => query.refetch()} />
      ) : clinics.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title={q || filter !== "all" ? "No clinics match" : "No clinics yet"}
          description={q || filter !== "all" ? "Try another search or filter." : "Add the first clinic to get started."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clinic</TableHead>
                <TableHead>Administrator</TableHead>
                <TableHead>Plan & payment</TableHead>
                <TableHead>Size & usage</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clinics.map((c) => (
                <ClinicRow key={c.id} clinic={c} onChangeStatus={() => setChanging(c)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Appointments count bookings dated this month that weren&apos;t cancelled; &quot;upcoming&quot; are bookings still ahead. &quot;Collected&quot; is money the clinic took from its patients, not what it pays you.
      </p>

      {adding && <AddClinicDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={changing !== null}
        onOpenChange={(open) => !open && setChanging(null)}
        title={changing?.status === "active" ? `Suspend ${changing?.name}?` : `Reactivate ${changing?.name}?`}
        description={
          changing?.status === "active"
            ? "Nobody at this clinic can sign in to it, and it disappears from the public website. Its records are kept, and you can reactivate it at any time."
            : "The clinic's staff and patients can sign in again, and it's listed on the public website."
        }
        confirmLabel={changing?.status === "active" ? "Suspend clinic" : "Reactivate clinic"}
        destructive={changing?.status === "active"}
        isLoading={setStatus.isPending}
        onConfirm={() =>
          changing &&
          setStatus.mutate({ id: changing.id, status: changing.status === "active" ? "suspended" : "active" }, {
            onSuccess: () => {
              toast.success(changing.status === "active" ? `${changing.name} suspended.` : `${changing.name} reactivated.`);
              setChanging(null);
            },
          })
        }
      />
    </div>
  );
}

/** Every problem across all clinics, with a button that goes straight to fixing it. */
function AttentionPanel({ items }: { items: { clinic: PlatformClinic; alert: ClinicAlert }[] }) {
  const [showAll, setShowAll] = useState(false);
  const order: Record<AlertTone, number> = { danger: 0, warning: 1, info: 2 };
  const sorted = [...items].sort((a, b) => order[a.alert.tone] - order[b.alert.tone] || a.clinic.name.localeCompare(b.clinic.name));
  const shown = showAll ? sorted : sorted.slice(0, 5);
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-muted px-4 py-3 text-sm text-success">
        <CheckCircle2Icon className="h-4 w-4" aria-hidden /> All clinics are in good shape: everyone has an administrator, and no payments are due.
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Needs your attention ({items.length})</CardTitle>
        <CardDescription>Fix these to keep clinics running and paying.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y">
          {shown.map(({ clinic, alert }) => (
            <li key={`${clinic.id}-${alert.key}`} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[alert.tone])} aria-hidden />
                <p className="text-sm">
                  <Link href={clinicHref(clinic.id)} className="font-medium text-foreground hover:text-primary hover:underline">{clinic.name}</Link>
                  <span className="text-muted-foreground"> · {alert.text}</span>
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" asChild>
                <Link href={clinicHref(clinic.id, alert.action)}>{alert.actionLabel}</Link>
              </Button>
            </li>
          ))}
        </ul>
        {sorted.length > 5 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${sorted.length}`}</Button>
        )}
      </CardContent>
    </Card>
  );
}

function ClinicRow({ clinic: c, onChangeStatus }: { clinic: PlatformClinic; onChangeStatus: () => void }) {
  const s = c.subscription;
  const full = limitsReached(c);
  const alerts = clinicAlerts(c);
  const worst = alerts.find((a) => a.tone === "danger") ?? alerts.find((a) => a.tone === "warning");
  return (
    <TableRow className={c.status === "suspended" ? "bg-muted/40" : undefined}>
      <TableCell className="min-w-56">
        <div className="flex items-center gap-2">
          <Link href={clinicHref(c.id)} className="font-medium text-foreground hover:text-primary hover:underline">{c.name}</Link>
          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
          {c.status !== "active" && <ClinicStatusBadge status={c.status} />}
        </div>
        <p className="text-xs text-muted-foreground">{c.city}, {c.state} · {c.phone}</p>
        <p className="text-xs text-muted-foreground">Added {formatDate(c.createdAt)}</p>
        <CopyClinicJoinLinkButton code={c.code} clinicName={c.name} />
        {worst && (
          <p className={cn("mt-1 flex items-center gap-1 text-xs", worst.tone === "danger" ? "text-danger" : "text-warning")}>
            <AlertTriangleIcon className="h-3 w-3" aria-hidden /> {worst.text}
          </p>
        )}
      </TableCell>
      <TableCell className="min-w-44">
        {c.admins.length === 0 ? (
          <Button variant="link" size="sm" className="h-auto p-0 text-danger" asChild>
            <Link href={clinicHref(c.id, "admin")}>+ Add administrator</Link>
          </Button>
        ) : (
          c.admins.map((a) => (
            <div key={a.email} className="text-sm">
              <p className="text-foreground">{a.name}</p>
              <p className="text-xs text-muted-foreground">{a.email}</p>
              {a.status === "invited" && <Badge variant="outline" className="mt-0.5 border-warning/40 text-warning">Not signed in yet</Badge>}
            </div>
          ))
        )}
      </TableCell>
      <TableCell className="min-w-48">
        {s ? (
          <div className="space-y-0.5 text-sm">
            <p className="text-foreground">{s.planName} <span className="text-xs text-muted-foreground">· {priceText(s)}</span></p>
            <div className="flex flex-wrap items-center gap-1.5">
              <SubscriptionBadge subscription={s} />
              <span className={cn("text-xs", s.state === "overdue" ? "text-danger" : "text-muted-foreground")}>
                {s.state === "overdue"
                  ? `since ${formatDate(s.paidUntil)}`
                  : s.state === "trial"
                    ? `ends ${formatDate(s.paidUntil, "dd MMM")} · ${plural(s.daysLeft, "day")} left`
                    : `until ${formatDate(s.paidUntil)}`}
              </span>
            </div>
          </div>
        ) : (
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link href={clinicHref(c.id, "plan")}>Choose a plan</Link>
          </Button>
        )}
      </TableCell>
      <TableCell className="min-w-60 text-sm">
        <p className="text-foreground">
          {plural(c.branches, "branch", "branches")} · {plural(c.doctors, "doctor")} · {c.staff} staff
          {full.length > 0 && <Badge variant="outline" className="ml-1.5 border-warning/40 text-warning">At plan limit</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {plural(c.patients, "patient")} · {plural(c.appointmentsThisMonth, "appointment")} this month
          {c.upcomingAppointments > 0 && ` (${c.upcomingAppointments} upcoming)`}
        </p>
        <p className="text-xs text-muted-foreground">{formatCurrency(c.revenueThisMonth)} collected from patients this month</p>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{c.lastActivityAt ? formatTimeAgo(c.lastActivityAt) : "Never"}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" asChild>
            <Link href={clinicHref(c.id)}>Manage</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`More actions for ${c.name}`}><MoreHorizontalIcon /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild disabled={!s}><Link href={clinicHref(c.id, "payment")}>Record payment</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={clinicHref(c.id, "plan")}>{s ? "Change plan" : "Choose plan"}</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={clinicHref(c.id, "admin")}>Add administrator</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={clinicHref(c.id, "edit")}>Edit details</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onChangeStatus} className={c.status === "active" ? "text-danger focus:text-danger" : undefined}>
                {c.status === "active" ? "Suspend clinic" : "Reactivate clinic"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

const EMPTY: PlatformClinicInput = { code: "", name: "", email: "", phone: "", addressLine: "", city: "", state: "", pincode: "", branchName: "", adminName: "", adminEmail: "" };

/** "Sunrise Health Clinic" → "SHC"; one word → its first 3 letters. */
const codeFrom = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3)).slice(0, 10);
};

function AddClinicDialog({ onClose }: { onClose: () => void }) {
  const create = useCreatePlatformClinic();
  const [form, setForm] = useState<PlatformClinicInput>(EMPTY);
  const [codeTouched, setCodeTouched] = useState(false);
  const set = (k: keyof PlatformClinicInput, v: string) =>
    setForm((f) => ({ ...f, [k]: v, ...(k === "name" && !codeTouched ? { code: codeFrom(v) } : {}) }));

  const missing = (["name", "code", "email", "phone", "addressLine", "city", "state", "pincode", "adminName", "adminEmail"] as const).filter((k) => !form[k].trim());
  const problem = missing.length
    ? null
    : !/^[A-Z0-9]{2,10}$/.test(form.code.trim().toUpperCase())
      ? "Clinic code: 2–10 letters or digits."
      : !/^[1-9][0-9]{5}$/.test(form.pincode.trim())
        ? "Enter a 6-digit PIN code."
        : null;

  function submit() {
    create.mutate(form, {
      onSuccess: (r) => {
        if (r.invitationSent) toast.success(`${form.name} added. ${r.adminEmail} has been emailed an invitation to sign in and set a password.`);
        else toast.warning(`${form.name} added, but the invitation to ${r.adminEmail} wasn't sent: ${r.invitationProblem ?? "unknown problem"} Use Resend in the list.`);
        onClose();
      },
    });
  }

  const field = (k: keyof PlatformClinicInput, label: string, props: React.ComponentProps<typeof Input> = {}, span = false) => (
    <div className={span ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={`pc-${k}`}>{label}</Label>
      <Input id={`pc-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a clinic</DialogTitle>
          <DialogDescription>
            Creates the clinic with its head-office branch on a 30-day free trial, and invites its administrator by email to sign in and set up the rest. Choose its paid plan later on the clinic&apos;s page.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clinic</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("name", "Clinic name", { maxLength: 120, autoFocus: true }, true)}
              <div className="space-y-1.5">
                <Label htmlFor="pc-code">Clinic code</Label>
                <Input id="pc-code" value={form.code} maxLength={10} className="uppercase" onChange={(e) => { setCodeTouched(true); set("code", e.target.value.toUpperCase()); }} />
                <p className="text-xs text-muted-foreground">Used in patient and bill numbers, e.g. {form.code || "SUN"}-INV-0001. Can&apos;t be changed later.</p>
              </div>
              {field("branchName", "Head-office branch name", { maxLength: 120, placeholder: "Main" })}
              {field("email", "Clinic email", { type: "email", maxLength: 254 })}
              {field("phone", "Clinic phone", { type: "tel", maxLength: 20 })}
              {field("addressLine", "Address", { maxLength: 300 }, true)}
              {field("city", "City", { maxLength: 80 })}
              {field("state", "State", { maxLength: 80 })}
              {field("pincode", "PIN code", { maxLength: 6, inputMode: "numeric" })}
            </div>
          </section>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clinic administrator</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("adminName", "Full name", { maxLength: 120 })}
              {field("adminEmail", "Email", { type: "email", maxLength: 254 })}
            </div>
            <p className="text-xs text-muted-foreground">They get an email to set their password, then manage staff, doctors, branches and settings themselves. If this email already has a Sehat Setu account, that account becomes the administrator.</p>
          </section>
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || missing.length > 0 || Boolean(problem)}>{create.isPending ? "Adding…" : "Add clinic"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangleIcon, Building2Icon, CalendarDaysIcon, IndianRupeeIcon, MailIcon, PlusIcon, RepeatIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { useCreatePlatformClinic, usePlatformOverview, useResendClinicAdminInvite, useSetPlatformClinicStatus } from "@/hooks/use-platform";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformClinic, PlatformClinicInput } from "@/lib/live-types";
import { ClinicStatusBadge, SubscriptionBadge, priceText } from "./platform-shared";

// The super admin console: every clinic on Sehat Setu with its usage and
// subscription, adding a clinic, and suspending or reactivating one. A clinic's
// name opens its own page (plan, payments, people, administrators). Counts
// only: no patient, clinical or billing records are shown here.

type Filter = "all" | "overdue" | "due_soon" | "trial" | "suspended";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Payment overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "trial", label: "On free trial" },
  { value: "suspended", label: "Suspended" },
];
const matches = (c: PlatformClinic, f: Filter) =>
  f === "all" || (f === "suspended" ? c.status === "suspended" : c.status === "active" && c.subscription?.state === f);

export function PlatformConsole() {
  const query = usePlatformOverview();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<PlatformClinic | null>(null);
  const setStatus = useSetPlatformClinicStatus();
  const resend = useResendClinicAdminInvite();
  const data = query.data;
  const q = search.trim().toLowerCase();
  const clinics = (data?.clinics ?? []).filter(
    (c) => matches(c, filter) && (!q || [c.name, c.code, c.city, c.email, ...c.admins.map((a) => a.email)].some((v) => v.toLowerCase().includes(q)))
  );
  const autoSuspended = data?.autoSuspended ?? 0;
  useEffect(() => {
    if (autoSuspended > 0) toast.warning(`${autoSuspended} clinic${autoSuspended === 1 ? " was" : "s were"} suspended automatically: payment overdue past the grace days.`);
  }, [autoSuspended]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="All clinics"
        description="Every clinic on Sehat Setu, how much it's used, and who runs it."
        actions={<Button onClick={() => setAdding(true)}><PlusIcon /> Add clinic</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Clinics" value={data ? `${data.totals.activeClinics} active / ${data.totals.clinics}` : "—"} icon={Building2Icon} isLoading={query.isLoading} />
        <StatCard label="Monthly recurring revenue" value={data ? formatCurrency(data.totals.mrr) : "—"} icon={RepeatIcon} isLoading={query.isLoading} />
        <StatCard label="Received from clinics this month" value={data ? formatCurrency(data.totals.subscriptionCollectedThisMonth) : "—"} icon={IndianRupeeIcon} isLoading={query.isLoading} />
        <StatCard
          label="Payment overdue / due soon"
          value={data ? `${data.totals.overdue} / ${data.totals.dueSoon}` : "—"}
          icon={AlertTriangleIcon}
          tone={data && data.totals.overdue > 0 ? "danger" : data && data.totals.dueSoon > 0 ? "warning" : "default"}
          isLoading={query.isLoading}
        />
        <StatCard label="Patients" value={data ? String(data.totals.patients) : "—"} icon={UsersIcon} isLoading={query.isLoading} />
        <StatCard label="Appointments this month" value={data ? String(data.totals.appointmentsThisMonth) : "—"} icon={CalendarDaysIcon} isLoading={query.isLoading} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clinic, code, city or admin email..." className="sm:w-80" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
          {FILTERS.map((f) => {
            const n = f.value === "all" ? null : (data?.clinics ?? []).filter((c) => matches(c, f.value)).length;
            return (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "secondary" : "ghost"}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn("h-8", f.value === "overdue" && n ? "text-danger" : undefined)}
              >
                {f.label}
                {n !== null && <span className="ml-1 tabular-nums text-muted-foreground">{n}</span>}
              </Button>
            );
          })}
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
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Branches</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead className="text-right">Doctors</TableHead>
                <TableHead className="text-right">Patients</TableHead>
                <TableHead className="text-right">Appts (month)</TableHead>
                <TableHead className="text-right">Clinic collected (month)</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clinics.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/platform/clinics/${c.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {c.name} <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.city}, {c.state} · {c.phone}</p>
                    <p className="text-xs text-muted-foreground">Added {formatDate(c.createdAt)}</p>
                  </TableCell>
                  <TableCell>
                    {c.admins.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      c.admins.map((a) => (
                        <div key={a.email} className="text-sm">
                          <p className="text-foreground">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{a.email}</p>
                          {a.status === "invited" && (
                            <div className="mt-0.5 flex items-center gap-1">
                              <Badge variant="outline" className="border-warning/40 text-warning">Not signed in yet</Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-xs"
                                disabled={resend.isPending}
                                onClick={() =>
                                  resend.mutate({ id: c.id, email: a.email }, {
                                    onSuccess: (r) => (r.sent ? toast.success(`Invitation sent to ${a.email}.`) : toast.error(r.problem ?? "The invitation couldn't be sent.")),
                                  })
                                }
                              >
                                <MailIcon className="h-3 w-3" /> Resend
                              </Button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </TableCell>
                  <TableCell>
                    {c.subscription ? (
                      <div className="space-y-0.5 text-sm">
                        <p className="text-foreground">{c.subscription.planName}</p>
                        <p className="text-xs text-muted-foreground">{priceText(c.subscription)}</p>
                        <div className="flex items-center gap-1.5">
                          <SubscriptionBadge subscription={c.subscription} />
                          <span className={cn("text-xs", c.subscription.state === "overdue" ? "text-danger" : "text-muted-foreground")}>
                            {c.subscription.state === "overdue" ? `since ${formatDate(c.subscription.paidUntil)}` : `to ${formatDate(c.subscription.paidUntil)}`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <SubscriptionBadge subscription={null} />
                    )}
                  </TableCell>
                  <TableCell className="text-right">{c.branches}</TableCell>
                  <TableCell className="text-right">{c.staff}</TableCell>
                  <TableCell className="text-right">{c.doctors}</TableCell>
                  <TableCell className="text-right">{c.patients}</TableCell>
                  <TableCell className="text-right">{c.appointmentsThisMonth}{c.upcomingAppointments > 0 && <span className="block text-xs text-muted-foreground">{c.upcomingAppointments} upcoming</span>}</TableCell>
                  <TableCell className="text-right">{formatCurrency(c.revenueThisMonth)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.lastActivityAt ? formatRelativeTime(c.lastActivityAt) : "Never"}</TableCell>
                  <TableCell>
                    <ClinicStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/platform/clinics/${c.id}`}>Manage</Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setChanging(c)}>{c.status === "active" ? "Suspend" : "Reactivate"}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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

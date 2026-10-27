"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, CreditCardIcon, MailIcon, PencilIcon, PlusIcon, UserMinusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { QueryError } from "@/components/shared/query-error";
import {
  useAddClinicAdmin,
  usePlatformClinic,
  usePlatformPlans,
  useRecordSubscriptionPayment,
  useRemoveClinicAdmin,
  useResendClinicAdminInvite,
  useSetPlatformClinicStatus,
  useSetSubscription,
  useUpdatePlatformClinic,
  useVoidSubscriptionPayment,
} from "@/hooks/use-platform";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClinicJoinLink } from "@/components/shared/clinic-join-link";
import type { BillingCycle, PlatformClinicDetail, PlatformClinicProfileInput, SubscriptionPayment, SubscriptionPaymentMethod } from "@/lib/live-types";
import { addDays, istToday, paidUntilAfterPayment, planPrice } from "@/server/data/platform-rules";
import { ActivityList, ClinicStatusBadge, LimitMeter, PAYMENT_METHODS, SubscriptionBadge, limitText, paidUntilText, priceText } from "./platform-shared";

// One clinic, for the super admin: its plan and payments to Sehat Setu, plan
// limits against what it uses, its administrators, people, branches, monthly
// usage and recent activity. Names and roles only: no patient, clinical or
// billing records.

export type ClinicDialog = "edit" | "plan" | "payment" | "admin";

export function PlatformClinicDetailView({ id, initialDialog = null }: { id: string; initialDialog?: ClinicDialog | null }) {
  const query = usePlatformClinic(id);
  const router = useRouter();
  const [dialog, setDialogState] = useState<null | ClinicDialog | "status">(initialDialog);
  const setDialog = (d: null | ClinicDialog | "status") => {
    setDialogState(d);
    // Drop ?do= once its dialog closes, so a refresh doesn't reopen it.
    if (d === null && initialDialog) router.replace(`/platform/clinics/${id}`, { scroll: false });
  };
  const [voiding, setVoiding] = useState<SubscriptionPayment | null>(null);
  const [removing, setRemoving] = useState<PlatformClinicDetail["people"][number] | null>(null);
  const setStatus = useSetPlatformClinicStatus();
  const removeAdmin = useRemoveClinicAdmin(id);
  const resend = useResendClinicAdminInvite();
  const c = query.data;

  if (query.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (query.error) return <QueryError error={query.error} what="This clinic" onRetry={() => query.refetch()} />;
  if (!c) return null;

  const sub = c.subscription;
  const admins = c.people.filter((p) => p.isAdmin);
  const latestValid = c.payments.find((p) => !p.voidedAt);
  const overdueSuspended = c.status === "suspended" && sub?.suspendedForNonPayment;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link href="/platform"><ArrowLeftIcon /> All clinics</Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">{c.name}</h1>
              <span className="font-mono text-sm text-muted-foreground">{c.code}</span>
              <ClinicStatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {c.addressLine}, {c.city}, {c.state} {c.pincode} · {c.phone} · {c.email}
            </p>
            <p className="text-xs text-muted-foreground">On Sehat Setu since {formatDate(c.createdAt)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setDialog("edit")}><PencilIcon /> Edit details</Button>
            <Button variant={c.status === "active" ? "outline" : "default"} onClick={() => setDialog("status")}>
              {c.status === "active" ? "Suspend" : "Reactivate"}
            </Button>
          </div>
        </div>
        {overdueSuspended && (
          <p role="status" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
            Suspended automatically because payment was overdue. Recording a payment that covers today reactivates it.
          </p>
        )}
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Patient registration &amp; booking link</CardTitle>
          <CardDescription>
            Send it to the clinic, or share it yourself. Patients who register through it join {c.name} and book with its doctors only.
            {c.status !== "active" && " It works again once the clinic is reactivated."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicJoinLink code={c.code} id="platform-join-link" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Subscription */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">Plan & payments</CardTitle>
              <CardDescription>What this clinic pays Sehat Setu.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog("plan")}>{sub ? "Change plan" : "Choose plan"}</Button>
              <Button size="sm" onClick={() => setDialog("payment")} disabled={!sub}><CreditCardIcon /> Record payment</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {sub ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="font-medium text-foreground">{sub.planName}</p>
                  <p className="text-sm text-muted-foreground">{priceText(sub)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <div className="flex items-center gap-2"><SubscriptionBadge subscription={sub} /></div>
                  <p className={cn("text-sm", sub.state === "overdue" ? "text-danger" : "text-muted-foreground")}>{paidUntilText(sub)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">If unpaid</p>
                  <p className="text-sm text-foreground">
                    {sub.autoSuspend ? `Suspend ${sub.graceDays} day${sub.graceDays === 1 ? "" : "s"} after paid-until` : "Don't suspend automatically"}
                  </p>
                  {sub.notes && <p className="mt-1 text-xs text-muted-foreground">{sub.notes}</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This clinic isn&apos;t on a plan yet, so no limits apply. Choose a plan to start tracking payments.</p>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paid on</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Covers</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.payments.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No payments recorded yet.</TableCell></TableRow>
                  ) : (
                    c.payments.map((p) => (
                      <TableRow key={p.id} className={p.voidedAt ? "opacity-60" : undefined}>
                        <TableCell className="whitespace-nowrap">{formatDate(p.paidOn)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", p.voidedAt && "line-through")}>{formatCurrency(p.amount)}</TableCell>
                        <TableCell>
                          {PAYMENT_METHODS[p.method]}
                          {p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDate(p.periodFrom)} – {formatDate(p.periodTo)}
                          <span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.recordedBy ?? "—"}
                          {p.notes && <span className="block text-xs">{p.notes}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.voidedAt ? (
                            <Badge variant="outline" className="text-muted-foreground" title={p.voidReason ?? undefined}>Voided</Badge>
                          ) : p.id === latestValid?.id ? (
                            <Button variant="ghost" size="sm" onClick={() => setVoiding(p)}>Void</Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Limits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan limits</CardTitle>
            <CardDescription>The clinic can&apos;t add more once it reaches a limit. You can always add administrators.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <LimitMeter label="Branches" used={c.counts.branches} max={sub?.limits.branches ?? null} />
            <LimitMeter label="Doctors" used={c.counts.doctors} max={sub?.limits.doctors ?? null} />
            <LimitMeter label="Staff (incl. doctors)" used={c.counts.staff} max={sub?.limits.staff ?? null} />
            <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Patients</p><p className="font-medium tabular-nums">{c.counts.patients}</p></div>
              <div><p className="text-xs text-muted-foreground">Using the patient portal</p><p className="font-medium tabular-nums">{c.counts.portalPatients}</p></div>
              <div><p className="text-xs text-muted-foreground">Staff invitations open</p><p className="font-medium tabular-nums">{c.counts.pendingInvitations}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Administrators */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Administrators</CardTitle>
            <CardDescription>They manage the clinic&apos;s staff, doctors, branches and settings.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDialog("admin")}><PlusIcon /> Add administrator</Button>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-sm text-danger">No administrator: nobody can manage this clinic. Add one.</p>
          ) : (
            <ul className="divide-y">
              {admins.map((a) => (
                <li key={a.userId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.accountStatus === "invited" && (
                      <>
                        <Badge variant="outline" className="border-warning/40 text-warning">Not signed in yet</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resend.isPending}
                          onClick={() =>
                            resend.mutate({ id: c.id, email: a.email }, {
                              onSuccess: (r) => (r.sent ? toast.success(`Invitation sent to ${a.email}.`) : toast.error(r.problem ?? "The invitation couldn't be sent.")),
                            })
                          }
                        >
                          <MailIcon /> Resend
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" disabled={admins.length < 2} title={admins.length < 2 ? "Add another administrator first" : undefined} onClick={() => setRemoving(a)}>
                      <UserMinusIcon /> Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage, last 6 months</CardTitle>
            <CardDescription>Appointments (not cancelled), new patients, and money the clinic collected from patients.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageBars usage={c.usage} />
          </CardContent>
        </Card>

        {/* Branches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {c.branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
                      {b.isHeadOffice && <Badge variant="outline" className="ml-2">Head office</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{b.city} · {b.phone}</p>
                  </div>
                  {b.status === "inactive" && <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* People */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">People ({c.people.filter((p) => p.status === "active").length} active)</CardTitle>
          <CardDescription>Everyone who works at the clinic. Their access is managed by the clinic&apos;s administrators.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.people.map((p) => (
                <TableRow key={p.userId} className={p.status === "inactive" ? "opacity-60" : undefined}>
                  <TableCell>
                    <p className="text-foreground">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.roles.length ? p.roles.join(", ") : "—"}
                    {p.specialty && <span className="block text-xs text-muted-foreground">{p.specialty}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.branch ?? "All branches"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(p.since)}</TableCell>
                  <TableCell>
                    {p.status === "inactive" ? (
                      <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                    ) : p.accountStatus === "invited" ? (
                      <Badge variant="outline" className="border-warning/40 text-warning">Not signed in yet</Badge>
                    ) : p.accountStatus === "disabled" ? (
                      <Badge variant="outline" className="border-danger/40 text-danger">Account disabled</Badge>
                    ) : (
                      <Badge variant="outline" className="border-success/40 text-success">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Activity */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Recent platform actions & problems</h2>
        <ActivityList clinicId={c.id} kind="all" showClinic={false} />
      </section>

      {dialog === "edit" && <EditClinicDialog clinic={c} onClose={() => setDialog(null)} />}
      {dialog === "plan" && <SubscriptionDialog clinic={c} onClose={() => setDialog(null)} />}
      {dialog === "payment" && sub && <PaymentDialog clinic={c} onClose={() => setDialog(null)} />}
      {dialog === "admin" && <AddAdminDialog clinicId={c.id} onClose={() => setDialog(null)} />}
      {voiding && <VoidPaymentDialog clinicId={c.id} payment={voiding} onClose={() => setVoiding(null)} />}

      <ConfirmDialog
        open={dialog === "status"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={c.status === "active" ? `Suspend ${c.name}?` : `Reactivate ${c.name}?`}
        description={
          c.status === "active"
            ? "Nobody at this clinic can sign in to it, and it disappears from the public website. Its records are kept, and you can reactivate it at any time."
            : sub?.autoSuspend && sub.state === "overdue"
              ? "Its payment is still overdue and auto-suspend is on, so it will be suspended again next time the console loads. Record a payment or change the paid-until date first."
              : "The clinic's staff and patients can sign in again, and it's listed on the public website."
        }
        confirmLabel={c.status === "active" ? "Suspend clinic" : "Reactivate clinic"}
        destructive={c.status === "active"}
        isLoading={setStatus.isPending}
        onConfirm={() =>
          setStatus.mutate({ id: c.id, status: c.status === "active" ? "suspended" : "active" }, {
            onSuccess: () => {
              toast.success(c.status === "active" ? `${c.name} suspended.` : `${c.name} reactivated.`);
              setDialog(null);
            },
          })
        }
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name} as administrator?`}
        description="They can no longer manage this clinic. Any other role they have here (for example Doctor) stays."
        confirmLabel="Remove administrator"
        destructive
        isLoading={removeAdmin.isPending}
        onConfirm={() =>
          removing &&
          removeAdmin.mutate(removing.userId, {
            onSuccess: () => {
              toast.success(`${removing.name} is no longer an administrator.`);
              setRemoving(null);
            },
          })
        }
      />
    </div>
  );
}

function UsageBars({ usage }: { usage: PlatformClinicDetail["usage"] }) {
  const max = Math.max(1, ...usage.map((u) => u.appointments));
  const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  return (
    <div className="space-y-2">
      {usage.map((u) => (
        <div key={u.month} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{label(u.month)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((u.appointments / max) * 100)}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{u.appointments}</span> appts · {u.newPatients} new · {formatCurrency(u.collected)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditClinicDialog({ clinic, onClose }: { clinic: PlatformClinicDetail; onClose: () => void }) {
  const update = useUpdatePlatformClinic(clinic.id);
  const [form, setForm] = useState<PlatformClinicProfileInput>({
    name: clinic.name, email: clinic.email, phone: clinic.phone, addressLine: clinic.addressLine, city: clinic.city, state: clinic.state, pincode: clinic.pincode,
  });
  const set = (k: keyof PlatformClinicProfileInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const missing = Object.values(form).some((v) => !v.trim());
  const badPin = !/^[1-9][0-9]{5}$/.test(form.pincode.trim());
  const input = (k: keyof PlatformClinicProfileInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field id={`ec-${k}`} label={label}><Input id={`ec-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} {...props} /></Field>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit clinic details</DialogTitle>
          <DialogDescription>The clinic code ({clinic.code}) can&apos;t change: it&apos;s part of every patient and bill number.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(form, { onSuccess: () => { toast.success("Clinic details saved."); onClose(); } });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{input("name", "Clinic name", { maxLength: 120, autoFocus: true })}</div>
            {input("email", "Clinic email", { type: "email", maxLength: 254 })}
            {input("phone", "Clinic phone", { type: "tel", maxLength: 20 })}
            <div className="sm:col-span-2">{input("addressLine", "Address", { maxLength: 300 })}</div>
            {input("city", "City", { maxLength: 80 })}
            {input("state", "State", { maxLength: 80 })}
            {input("pincode", "PIN code", { maxLength: 6, inputMode: "numeric" })}
          </div>
          {!missing && badPin && <p role="alert" className="text-sm text-danger">Enter a 6-digit PIN code.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>Cancel</Button>
            <Button type="submit" disabled={update.isPending || missing || badPin}>{update.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionDialog({ clinic, onClose }: { clinic: PlatformClinicDetail; onClose: () => void }) {
  const plans = usePlatformPlans();
  const save = useSetSubscription(clinic.id);
  const sub = clinic.subscription;
  const [planId, setPlanId] = useState(sub?.planId ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(sub?.billingCycle ?? "monthly");
  const [price, setPrice] = useState(sub ? String(sub.price) : "");
  const [paidUntil, setPaidUntil] = useState(sub?.paidUntil ?? addDays(istToday(), 30));
  const [autoSuspend, setAutoSuspend] = useState(sub?.autoSuspend ?? false);
  const [grace, setGrace] = useState(String(sub?.graceDays ?? 7));
  const [notes, setNotes] = useState(sub?.notes ?? "");

  const available = (plans.data ?? []).filter((p) => p.isActive || p.id === sub?.planId);
  const plan = available.find((p) => p.id === planId);
  const pick = (id: string, c: BillingCycle) => {
    const p = available.find((x) => x.id === id);
    if (p) setPrice(String(planPrice(p, c)));
  };
  const over = plan
    ? ([["branches", clinic.counts.branches, plan.maxBranches], ["doctors", clinic.counts.doctors, plan.maxDoctors], ["staff", clinic.counts.staff, plan.maxStaff]] as const)
        .filter(([, used, max]) => max !== null && used > max)
    : [];
  const priceNum = Number(price);
  const graceNum = Number(grace);
  const valid = Boolean(plan) && price.trim() !== "" && Number.isFinite(priceNum) && priceNum >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(paidUntil) && Number.isInteger(graceNum) && graceNum >= 0 && graceNum <= 90;

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sub ? "Change plan" : "Choose a plan"}</DialogTitle>
          <DialogDescription>To record money received, use Record payment: it moves paid-until forward for you.</DialogDescription>
        </DialogHeader>
        {plans.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : plans.error ? (
          <QueryError error={plans.error} what="Plans" onRetry={() => plans.refetch()} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { planId, billingCycle: cycle, price: priceNum, paidUntil, autoSuspend, graceDays: graceNum, notes },
                { onSuccess: () => { toast.success("Subscription saved."); onClose(); } }
              );
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sub-plan" label="Plan">
                <Select value={planId} onValueChange={(v) => { setPlanId(v); pick(v, cycle); }}>
                  <SelectTrigger id="sub-plan"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>{available.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{!p.isActive && " (retired)"}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="sub-cycle" label="Billed">
                <Select value={cycle} onValueChange={(v) => { setCycle(v as BillingCycle); pick(planId, v as BillingCycle); }}>
                  <SelectTrigger id="sub-cycle"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field id="sub-price" label={`Agreed price per ${cycle === "yearly" ? "year" : "month"} (₹)`} hint={plan ? `List price ${formatCurrency(planPrice(plan, cycle))}` : undefined}>
                <Input id="sub-price" type="number" min={0} step="1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field id="sub-until" label="Paid until" hint="Inclusive. Set by hand only to correct it.">
                <Input id="sub-until" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
              </Field>
            </div>
            {plan && (
              <p className="text-xs text-muted-foreground">
                Limits: {limitText(plan.maxBranches)} branches · {limitText(plan.maxDoctors)} doctors · {limitText(plan.maxStaff)} staff
              </p>
            )}
            {over.length > 0 && (
              <p role="alert" className="rounded-md bg-warning-muted px-3 py-2 text-sm text-warning">
                The clinic already has more {over.map(([k, used, max]) => `${k} (${used}, plan allows ${max})`).join(" and ")}. Nothing is removed, but it can&apos;t add more until it&apos;s under the limit.
              </p>
            )}
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="sub-auto">Suspend automatically if unpaid</Label>
                <p className="text-xs text-muted-foreground">After paid-until plus the grace days. Paying reactivates it.</p>
              </div>
              <Switch id="sub-auto" checked={autoSuspend} onCheckedChange={setAutoSuspend} />
            </div>
            {autoSuspend && (
              <Field id="sub-grace" label="Grace days">
                <Input id="sub-grace" type="number" min={0} max={90} className="w-28" value={grace} onChange={(e) => setGrace(e.target.value)} />
              </Field>
            )}
            <Field id="sub-notes" label="Notes (only you see these)">
              <Textarea id="sub-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 20% launch discount until March" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
              <Button type="submit" disabled={save.isPending || !valid}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ clinic, onClose }: { clinic: PlatformClinicDetail; onClose: () => void }) {
  const sub = clinic.subscription!;
  const record = useRecordSubscriptionPayment(clinic.id);
  const today = istToday();
  const defaultMonths = sub.billingCycle === "yearly" ? 12 : 1;
  const amountFor = (m: number) => String(Math.round((sub.billingCycle === "yearly" ? (sub.price * m) / 12 : sub.price * m) * 100) / 100);
  const [months, setMonths] = useState(String(defaultMonths));
  const [amount, setAmount] = useState(sub.price > 0 ? amountFor(defaultMonths) : "");
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<SubscriptionPaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [notes, setNotes] = useState("");

  const m = Number(months);
  const a = Number(amount);
  const validMonths = Number.isInteger(m) && m >= 1 && m <= 36;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && paidOn <= today;
  const valid = validMonths && validDate && Number.isFinite(a) && a >= 1;
  const period = validMonths && validDate ? paidUntilAfterPayment(sub.paidUntil, paidOn, m) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !record.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a payment from {clinic.name}</DialogTitle>
          <DialogDescription>Money the clinic paid you for its {sub.planName} plan ({priceText(sub)}).</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate({ amount: a, method, reference, paidOn, months: m, notes }, {
              onSuccess: (r) => {
                toast.success(`Payment recorded. Paid until ${formatDate(r.paidUntil)}.${r.reactivated ? " The clinic has been reactivated." : ""}`);
                onClose();
              },
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pay-months" label="Months it covers">
              <Input
                id="pay-months"
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(e) => {
                  setMonths(e.target.value);
                  const n = Number(e.target.value);
                  if (!amountTouched && sub.price > 0 && Number.isInteger(n) && n >= 1) setAmount(amountFor(n));
                }}
              />
            </Field>
            <Field id="pay-amount" label="Amount received (₹)">
              <Input id="pay-amount" type="number" min={1} step="0.01" inputMode="decimal" value={amount} onChange={(e) => { setAmountTouched(true); setAmount(e.target.value); }} />
            </Field>
            <Field id="pay-method" label="Paid by">
              <Select value={method} onValueChange={(v) => setMethod(v as SubscriptionPaymentMethod)}>
                <SelectTrigger id="pay-method"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PAYMENT_METHODS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="pay-on" label="Received on">
              <Input id="pay-on" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field id="pay-ref" label="Reference (optional)" hint="UTR, cheque number or receipt number.">
                <Input id="pay-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="pay-notes" label="Notes (optional)">
                <Textarea id="pay-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </div>
          {period && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground">
              Covers {formatDate(period.from)} – {formatDate(period.to)}. Paid until moves from {formatDate(sub.paidUntil)} to <strong>{formatDate(period.to)}</strong>.
            </p>
          )}
          {!validDate && <p role="alert" className="text-sm text-danger">The payment date can&apos;t be in the future.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={record.isPending}>Cancel</Button>
            <Button type="submit" disabled={record.isPending || !valid}>{record.isPending ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidPaymentDialog({ clinicId, payment, onClose }: { clinicId: string; payment: SubscriptionPayment; onClose: () => void }) {
  const voidPayment = useVoidSubscriptionPayment(clinicId);
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && !voidPayment.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void this payment?</DialogTitle>
          <DialogDescription>
            {formatCurrency(payment.amount)} received {formatDate(payment.paidOn)}. Use this only for a payment recorded by mistake: paid-until goes back to before it. It stays in the list, marked voided.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            voidPayment.mutate({ paymentId: payment.id, reason }, {
              onSuccess: (r) => { toast.success(`Payment voided. Paid until is now ${formatDate(r.paidUntil)}.`); onClose(); },
            });
          }}
        >
          <Field id="void-reason" label="Why?">
            <Input id="void-reason" maxLength={300} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered the wrong amount" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={voidPayment.isPending}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={voidPayment.isPending || reason.trim().length < 3}>{voidPayment.isPending ? "Voiding…" : "Void payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddAdminDialog({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const add = useAddClinicAdmin(clinicId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>
            If this email already has a Sehat Setu account, that account becomes an administrator here. Otherwise they&apos;re emailed an invitation to set a password.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ name, email }, {
              onSuccess: (r) => {
                const who = email.trim().toLowerCase();
                if (r.invitationSent === null) toast.success(`${who} is now an administrator. They'll see this clinic next time they sign in.`);
                else if (r.invitationSent) toast.success(`${who} is now an administrator and has been emailed an invitation.`);
                else toast.warning(`${who} is now an administrator, but the invitation wasn't sent: ${r.invitationProblem ?? "unknown problem"} Use Resend.`);
                onClose();
              },
            });
          }}
        >
          <Field id="adm-name" label="Full name"><Input id="adm-name" maxLength={120} autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="adm-email" label="Email"><Input id="adm-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>Cancel</Button>
            <Button type="submit" disabled={add.isPending || !valid}>{add.isPending ? "Adding…" : "Add administrator"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

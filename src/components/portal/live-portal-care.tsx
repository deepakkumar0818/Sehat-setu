"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CheckCircle2Icon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  Loader2Icon,
  MapPinIcon,
  ReceiptIcon,
  StethoscopeIcon,
  UserIcon,
  VideoIcon,
  WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useOnboarding } from "@/components/portal/health-profile-card";
import { ApiRequestError } from "@/lib/api-client";
import { formatCurrency, formatDate, formatTime12h } from "@/lib/format";
import { istGreeting, istTodayKey } from "@/lib/ist";
import { formatPhone } from "@/lib/phone";
import { ALLERGY_STATUS_LABEL, ONSETS, SEVERITIES, GENDERS, labelOf } from "@/lib/patient-intake";
import { cn } from "@/lib/utils";
import {
  usePortalAppointments,
  usePortalBook,
  usePortalBookingOptions,
  usePortalCancel,
  usePortalDashboard,
  usePortalInvoices,
  usePortalPay,
  usePortalRecord,
  usePortalReschedule,
  usePortalSlots,
} from "@/hooks/use-portal";
import type { PortalAppointment, PortalAppointmentScope, PortalAppointmentStatus, PortalBookingDoctor, PortalInvoice } from "@/lib/live-types";

// Patient portal screens with live data: the signed-in patient's OWN
// appointments, booking, health profile and bills. Everything comes from
// /api/v1/portal/*, which decides whose records these are from the session —
// nothing here sends a patient or clinic id. Availability shown here is a hint;
// the server re-checks every booking under a lock.

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.");

function LoadError({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  return <ErrorState title={`Couldn't load your ${what}`} description={errorMessage(error)} onRetry={onRetry} />;
}

const STATUS: Record<PortalAppointmentStatus, { label: string; className: string }> = {
  pending_approval: { label: "Awaiting receptionist approval", className: "bg-warning/10 text-warning" },
  rejected: { label: "Declined", className: "bg-danger/10 text-danger" },
  scheduled: { label: "Scheduled", className: "bg-primary/10 text-primary" },
  confirmed: { label: "Confirmed", className: "bg-success/10 text-success" },
  checked_in: { label: "Checked in", className: "bg-warning/10 text-warning" },
  in_consultation: { label: "In consultation", className: "bg-warning/10 text-warning" },
  completed: { label: "Completed", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-danger/10 text-danger" },
  no_show: { label: "Missed", className: "bg-muted text-muted-foreground" },
};

/** A pending request whose time has passed without approval is shown as expired. */
const isExpiredRequest = (a: Pick<PortalAppointment, "status" | "startsAt">) => a.status === "pending_approval" && Date.parse(a.startsAt) <= Date.now();

export function AppointmentStatusBadge({ status, startsAt }: { status: PortalAppointmentStatus; startsAt?: string }) {
  const s = startsAt && isExpiredRequest({ status, startsAt }) ? { label: "Request expired", className: "bg-muted text-muted-foreground" } : STATUS[status];
  return <Badge variant="outline" className={cn("border-transparent", s.className)}>{s.label}</Badge>;
}

/** What a pending or declined request means for the patient (nothing for other states). */
function RequestNote({ appt }: { appt: PortalAppointment }) {
  if (appt.status === "rejected") {
    return (
      <p className="text-xs text-danger" data-testid="rejection-reason">
        The clinic declined this request{appt.rejectionReason ? `: ${appt.rejectionReason}` : "."} Please book another time or contact the clinic.
      </p>
    );
  }
  if (appt.status !== "pending_approval") return null;
  return isExpiredRequest(appt) ? (
    <p className="text-xs text-muted-foreground">The clinic didn&apos;t confirm this request before its time. Please book a new appointment.</p>
  ) : (
    <p className="text-xs text-warning">Not confirmed yet: reception will review your request. You&apos;ll see the update here.</p>
  );
}

const INVOICE_STATUS: Record<PortalInvoice["status"], { label: string; className: string }> = {
  pending: { label: "Unpaid", className: "bg-warning/10 text-warning" },
  partially_paid: { label: "Partly paid", className: "bg-warning/10 text-warning" },
  paid: { label: "Paid", className: "bg-success/10 text-success" },
};

function ageOf(dob: string): number | null {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

const GENDER_LABEL = { male: "Male", female: "Female", other: "Other" } as const;

// --- Online payment (Razorpay Checkout; the server decides the amount) -------------

function PayButton({ purpose, id, label, size = "sm" }: { purpose: "invoice" | "booking_fee"; id: string; label: string; size?: "sm" | "default" }) {
  const pay = usePortalPay();
  return (
    <Button
      size={size}
      disabled={pay.isPending}
      onClick={() => {
        if (pay.isPending) return;
        pay.mutate(
          { purpose, id },
          {
            onSuccess: (r) => {
              if (!r) return; // window closed: nothing happened
              if (r.status === "refunded") toast.info("This booking is no longer open, so your payment is being refunded.");
              else toast.success("Payment received. Thank you!");
            },
            onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed."),
          }
        );
      }}
    >
      {pay.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CreditCardIcon />}
      {label}
    </Button>
  );
}

function FeeBadge({ appt }: { appt: PortalAppointment }) {
  if (appt.feePaid) return <Badge variant="outline" className="border-transparent bg-success/10 text-success">Fee paid</Badge>;
  if (appt.feeRefunded) return <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">Fee refunded</Badge>;
  return null;
}

// --- One appointment, with the actions the server allows ------------------------

function AppointmentRow({ appt, actions = true }: { appt: PortalAppointment; actions?: boolean }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const cancel = usePortalCancel();
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="portal-appointment">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{formatDate(appt.date, "EEE, dd MMM yyyy")} · {formatTime12h(appt.time)}</p>
          <AppointmentStatusBadge status={appt.status} startsAt={appt.startsAt} />
          {appt.type === "online" && <Badge variant="outline" className="gap-1"><VideoIcon className="h-3 w-3" /> Online</Badge>}
          <FeeBadge appt={appt} />
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {appt.doctorName ?? "Doctor"}{appt.specialty ? ` · ${appt.specialty}` : ""}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {appt.type === "online" ? "Online consultation" : (appt.branchName ?? "Clinic")} · Ref. {appt.reference} · {appt.reason}
        </p>
        <RequestNote appt={appt} />
      </div>
      {actions && (appt.canCancel || appt.canReschedule || appt.canPayFee) && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {appt.canPayFee && appt.fee ? <PayButton purpose="booking_fee" id={appt.id} label={`Pay fee ${formatCurrency(appt.fee)}`} /> : null}
          {appt.canReschedule && <Button size="sm" variant="outline" onClick={() => setRescheduleOpen(true)}>Reschedule</Button>}
          {appt.canCancel && <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>{appt.status === "pending_approval" ? "Withdraw" : "Cancel"}</Button>}
        </div>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={appt.status === "pending_approval" ? "Withdraw this request?" : "Cancel this appointment?"}
        description={`${appt.doctorName ?? "Your doctor"} on ${formatDate(appt.date)} at ${formatTime12h(appt.time)}. The slot will be released for other patients.`}
        confirmLabel={appt.status === "pending_approval" ? "Withdraw request" : "Cancel appointment"}
        destructive
        isLoading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(appt.id, {
            onSuccess: () => {
              toast.success(appt.status === "pending_approval" ? "Request withdrawn." : "Appointment cancelled.");
              setCancelOpen(false);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      {rescheduleOpen && <RescheduleDialog appt={appt} onClose={() => setRescheduleOpen(false)} />}
    </div>
  );
}

function RescheduleDialog({ appt, onClose }: { appt: PortalAppointment; onClose: () => void }) {
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const reschedule = usePortalReschedule();
  return (
    <Dialog open onOpenChange={(o) => !o && !reschedule.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>
            Same doctor and branch: {appt.doctorName ?? "your doctor"}, {appt.branchName ?? "clinic"}. Currently {formatDate(appt.date)} at {formatTime12h(appt.time)}.
            {" "}The new time is a request: reception approves it before it&apos;s confirmed.
          </DialogDescription>
        </DialogHeader>
        <SlotPicker doctorId={appt.doctorId} branchId={appt.branchId} date={date} time={time} onDate={(d) => { setDate(d); setTime(""); }} onTime={setTime} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reschedule.isPending}>Keep current time</Button>
          <Button
            disabled={!date || !time || reschedule.isPending}
            onClick={() => {
              setError(null);
              reschedule.mutate(
                { id: appt.id, date, time },
                {
                  onSuccess: () => {
                    toast.success("New time requested. It's awaiting receptionist approval.");
                    onClose();
                  },
                  onError: (e) => {
                    setError(errorMessage(e));
                    if (e instanceof ApiRequestError && e.code === "SLOT_TAKEN") setTime("");
                  },
                }
              );
            }}
          >
            {reschedule.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Confirm new time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Date + slot picker -------------------------------------------------------------

/** The next bookable calendar days (IST), skipping Sundays (the clinic is closed). */
function upcomingDays(count: number): string[] {
  const out: string[] = [];
  const start = new Date(`${istTodayKey(new Date())}T00:00:00Z`);
  for (let i = 0; out.length < count && i < 60; i++) {
    const d = new Date(start.getTime() + i * 864e5);
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function SlotPicker({ doctorId, branchId, date, time, onDate, onTime, maxDaysAhead = 60 }: { doctorId: string; branchId: string; date: string; time: string; onDate: (d: string) => void; onTime: (t: string) => void; maxDaysAhead?: number }) {
  const days = useMemo(() => upcomingDays(14), []);
  const today = istTodayKey(new Date());
  const last = new Date(new Date(`${today}T00:00:00Z`).getTime() + maxDaysAhead * 864e5).toISOString().slice(0, 10);
  const slots = usePortalSlots({ doctorId, branchId, date: date || undefined });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Date</Label>
        <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Choose a date">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={d === date}
              onClick={() => onDate(d)}
              className={cn("flex min-w-16 shrink-0 flex-col items-center rounded-md border px-3 py-2 text-xs", d === date ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <span>{formatDate(d, "EEE")}</span>
              <span className="text-base font-semibold">{formatDate(d, "dd")}</span>
              <span>{formatDate(d, "MMM")}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="other-date" className="shrink-0 text-muted-foreground">Another date</Label>
          <Input id="other-date" type="date" className="max-w-44" min={today} max={last} value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Time</Label>
        {!date ? (
          <p className="text-sm text-muted-foreground">Choose a date to see free times.</p>
        ) : slots.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : slots.isError ? (
          <p role="alert" className="text-sm text-danger">{errorMessage(slots.error)}</p>
        ) : slots.data!.slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No free times on this day. Please choose another date — the clinic is closed on Sundays.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label="Choose a time">
            {slots.data!.slots.map((t) => (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={t === time}
                onClick={() => onTime(t)}
                className={cn("rounded-md border px-2 py-2 text-sm", t === time ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {formatTime12h(t)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Home / dashboard -------------------------------------------------------------

const QUICK_ACCESS = [
  { href: "/portal/appointments", label: "Appointments", icon: CalendarDaysIcon, tint: "bg-primary/10 text-primary" },
  { href: "/portal/profile", label: "Health Profile", icon: HeartPulseIcon, tint: "bg-danger/10 text-danger" },
  { href: "/portal/reports", label: "Reports", icon: FlaskConicalIcon, tint: "bg-success/10 text-success" },
  { href: "/portal/documents", label: "Documents", icon: FileTextIcon, tint: "bg-warning/10 text-warning" },
  { href: "/portal/payments", label: "Bills & Payments", icon: WalletIcon, tint: "bg-ai/10 text-ai" },
] as const;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function LivePortalDashboard() {
  const q = usePortalDashboard();
  if (q.isLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      </div>
    );
  }
  if (q.isError) return <LoadError error={q.error} what="portal" onRetry={() => q.refetch()} />;
  const d = q.data!;
  const p = d.patient;
  const age = p ? ageOf(p.dateOfBirth) : null;
  const [next, ...laterUpcoming] = d.upcoming;
  const subtitle: Record<(typeof QUICK_ACCESS)[number]["href"], string> = {
    "/portal/appointments": d.upcoming.length ? `${d.upcoming.length} upcoming` : "View history",
    "/portal/profile": "Your details",
    "/portal/reports": d.reportCount ? `${d.reportCount} shared` : "None yet",
    "/portal/documents": d.documentCount ? `${d.documentCount} file${d.documentCount > 1 ? "s" : ""}` : "None yet",
    "/portal/payments": d.invoices.outstandingCount ? `${d.invoices.outstandingCount} unpaid` : "All settled",
  };

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground shadow-sm sm:p-6" data-testid="portal-welcome">
        <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-semibold" aria-hidden>
              {p ? initialsOf(p.name) : <UserIcon className="h-6 w-6" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-primary-foreground/80">{istGreeting(new Date())},</p>
              <h1 className="truncate text-xl font-semibold sm:text-2xl">{p ? p.name : "Welcome"}</h1>
              <p className="truncate text-sm text-primary-foreground/80">
                {p ? `Patient no. ${p.patientNumber} · ` : ""}{d.clinicName}
              </p>
              {p && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs" data-testid="portal-profile-summary">
                  <span className="rounded-full bg-white/15 px-2 py-0.5">{age ?? "—"} yrs · {GENDER_LABEL[p.gender]}</span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5">Blood group: {p.bloodGroup ?? "Not recorded"}</span>
                  {p.branchName && <span className="rounded-full bg-white/15 px-2 py-0.5">{p.branchName}</span>}
                </div>
              )}
            </div>
          </div>
          <Button asChild size="lg" variant="secondary" className="shrink-0 bg-white text-primary hover:bg-white/90">
            <Link href="/portal/book"><CalendarPlusIcon /> Book Appointment</Link>
          </Button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3" data-testid="next-appointment">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Your next appointment</CardTitle>
            {d.upcoming.length > 0 && <Link href="/portal/appointments" className="text-sm text-primary hover:underline">Manage</Link>}
          </CardHeader>
          <CardContent>
            {next ? (
              <div className="space-y-3">
                <div className="flex gap-4">
                  <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 py-2 text-primary">
                    <span className="text-xs font-medium uppercase">{formatDate(next.date, "EEE")}</span>
                    <span className="text-2xl font-semibold leading-tight">{formatDate(next.date, "dd")}</span>
                    <span className="text-xs">{formatDate(next.date, "MMM")}</span>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{formatTime12h(next.time)}</p>
                      <AppointmentStatusBadge status={next.status} startsAt={next.startsAt} />
                    </div>
                    <p className="truncate text-sm text-foreground">{next.doctorName ?? "Doctor"}{next.specialty ? ` · ${next.specialty}` : ""}</p>
                    <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                      {next.type === "online" ? <><VideoIcon className="h-3.5 w-3.5" aria-hidden /> Online consultation</> : <><MapPinIcon className="h-3.5 w-3.5" aria-hidden /> {next.branchName ?? "Clinic"}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">Ref. {next.reference}</p>
                    <RequestNote appt={next} />
                  </div>
                </div>
                {laterUpcoming.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    + {laterUpcoming.length} more upcoming · <Link href="/portal/appointments" className="text-primary hover:underline">see all</Link>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">No upcoming appointments</p>
                  <p className="text-sm text-muted-foreground">Book a visit with one of your clinic&apos;s doctors — in person or online.</p>
                </div>
                <Button asChild><Link href="/portal/book">Book Appointment</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <ProfileProgressCard />
        </div>
      </div>

      <nav aria-label="Quick access" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {QUICK_ACCESS.map((a) => (
          <Link key={a.href} href={a.href} className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", a.tint)}>
              <a.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{a.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{subtitle[a.href]}</span>
            </span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Recent visits</CardTitle>
            {d.recent.length > 0 && <Link href="/portal/appointments?tab=past" className="text-sm text-primary hover:underline">View all</Link>}
          </CardHeader>
          <CardContent className="p-0">
            {d.recent.length === 0 ? (
              <EmptyState icon={CalendarCheckIcon} title="No past visits yet" description="Your completed appointments will appear here." />
            ) : (
              <div className="divide-y">{d.recent.map((a) => <AppointmentRow key={a.id} appt={a} actions={false} />)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Bills</CardTitle>
            <Link href="/portal/payments" className="text-sm text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            {d.invoices.outstandingCount === 0 ? (
              <EmptyState icon={ReceiptIcon} title="Nothing to pay" description="You have no outstanding bills." />
            ) : (
              <div>
                <p className="px-4 pb-2 text-sm text-muted-foreground">
                  {d.invoices.outstandingCount} unpaid · <span className="font-medium text-foreground">{formatCurrency(d.invoices.outstandingBalance)}</span> due — payable at the clinic
                </p>
                <div className="divide-y border-t">{d.invoices.latest.map((i) => <InvoiceRow key={i.id} inv={i} />)}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Health-profile progress, from the server-side onboarding state (never decided in the browser). */
function ProfileProgressCard() {
  const onboarding = useOnboarding();
  if (!onboarding) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle>Health profile</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Your health profile isn&apos;t available right now.</p>
          <Button asChild variant="outline" size="sm"><Link href="/portal/profile">Open health profile</Link></Button>
        </CardContent>
      </Card>
    );
  }
  const { state, openAt } = onboarding;
  const steps = [
    { done: state.progress.personalSaved, label: "Personal details" },
    { done: state.progress.medicalReviewed, label: "Medical history" },
    { done: state.progress.completed, label: "Profile complete" },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="h-full" data-testid="profile-progress">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Health profile</CardTitle>
        <span className="text-xs text-muted-foreground">{done} of 3</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={(done / 3) * 100} aria-label={`Health profile ${done} of 3 steps done`} />
        <ul className="space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <CheckCircle2Icon className={cn("h-4 w-4 shrink-0", s.done ? "text-success" : "text-muted-foreground/40")} aria-hidden />
              <span className={s.done ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
              <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
            </li>
          ))}
        </ul>
        {state.completed ? (
          <Button asChild variant="outline" size="sm" className="w-full"><Link href="/portal/profile">Review my health profile</Link></Button>
        ) : (
          <Button size="sm" className="w-full" onClick={() => openAt()}>{done ? "Continue setup" : "Start — about 5 minutes"}</Button>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words font-medium text-foreground">{value}</p>
    </div>
  );
}

// --- Booking --------------------------------------------------------------------

type Step = "branch" | "doctor" | "time" | "details" | "review" | "done";

/**
 * `initialDoctorId` (e.g. from "Book" on the public doctor directory): starts at the
 * doctor's times when that doctor is bookable here, else at the normal first step.
 * The page mounts this once the booking options are loaded, so the preset is read
 * from them when the state is created.
 */
export function LivePortalBooking({ initialDoctorId }: { initialDoctorId?: string } = {}) {
  const options = usePortalBookingOptions();
  const book = usePortalBook();
  const submitting = useRef(false);
  const preset = initialDoctorId ? options.data?.doctors.find((d) => d.id === initialDoctorId) : undefined;
  const presetBranch = preset ? (preset.branchIds.length === 1 ? preset.branchIds[0] : options.data?.branches.length === 1 ? options.data.branches[0].id : "") : "";
  const [branchId, setBranchId] = useState(presetBranch);
  const [doctorId, setDoctorId] = useState(preset?.id ?? "");
  const [specialty, setSpecialty] = useState("all");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [visitType, setVisitType] = useState<"in_person" | "online">("in_person");
  const [addSymptoms, setAddSymptoms] = useState(false);
  const [symptoms, setSymptoms] = useState("");
  const [onset, setOnset] = useState("");
  const [severity, setSeverity] = useState("");
  const [requestId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : ""));
  const [step, setStep] = useState<Step | null>(preset ? (presetBranch ? "time" : "branch") : null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<PortalAppointment | null>(null);

  if (options.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (options.isError) return <LoadError error={options.error} what="booking options" onRetry={() => options.refetch()} />;
  const o = options.data!;
  const singleBranch = o.branches.length === 1 ? o.branches[0].id : "";
  const effectiveBranch = branchId || singleBranch;
  const current: Step = step ?? (effectiveBranch ? "doctor" : "branch");
  const branch = o.branches.find((b) => b.id === effectiveBranch);
  const doctorsHere = o.doctors.filter((d) => d.branchIds.includes(effectiveBranch));
  const specialties = [...new Set(doctorsHere.map((d) => d.specialty).filter((s): s is string => Boolean(s)))].sort();
  const shownDoctors = specialty === "all" ? doctorsHere : doctorsHere.filter((d) => d.specialty === specialty);
  const doctor = o.doctors.find((d) => d.id === doctorId);

  if (o.branches.length === 0 || o.doctors.length === 0) {
    return (
      <BookingFrame>
        <EmptyState icon={StethoscopeIcon} title="Online booking isn't open yet" description="Your clinic hasn't listed any doctors for online booking. Please call the clinic to book." />
      </BookingFrame>
    );
  }

  const detailsValid = reason.trim().length >= 2 && (!addSymptoms || (symptoms.trim().length >= 2 && Boolean(onset)));

  function submit() {
    // One request per click: a second click before the first answer does nothing.
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    book.mutate(
      {
        branchId: effectiveBranch,
        doctorId,
        date,
        time,
        reason: reason.trim(),
        type: visitType === "online" && doctor?.offersOnline ? "online" : "in_person",
        symptoms: addSymptoms && requestId ? { requestId, symptoms: symptoms.trim(), onset, severity: severity || null } : null,
      },
      {
        onSuccess: (a) => {
          setBooked(a);
          setStep("done");
        },
        onSettled: () => {
          submitting.current = false;
        },
        onError: (e) => {
          setError(errorMessage(e));
          // Someone else took the slot meanwhile: back to the times, freshly loaded.
          if (e instanceof ApiRequestError && (e.code === "SLOT_TAKEN" || e.code === "CONFLICT" || e.code === "DUPLICATE")) {
            setTime("");
            setStep("time");
          }
        },
      }
    );
  }

  if (current === "done" && booked) {
    return (
      <BookingFrame>
        <Card data-testid="booking-confirmation">
          <CardContent className="space-y-4 text-center">
            <CheckCircle2Icon className="mx-auto h-10 w-10 text-success" aria-hidden />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">{booked.status === "pending_approval" ? "Request sent" : "Appointment booked"}</h2>
              <p className="text-sm text-muted-foreground">Reference <span className="font-mono font-medium text-foreground">{booked.reference}</span></p>
            </div>
            <div className="mx-auto max-w-sm space-y-1 text-left text-sm">
              <SummaryLine icon={CalendarDaysIcon} text={`${formatDate(booked.date, "EEEE, dd MMM yyyy")} at ${formatTime12h(booked.time)}`} />
              <SummaryLine icon={UserIcon} text={`${booked.doctorName ?? "Doctor"}${booked.specialty ? ` · ${booked.specialty}` : ""}`} />
              {booked.type === "online" ? (
                <SummaryLine icon={VideoIcon} text="Online consultation — the clinic will send you the joining details before your visit" />
              ) : (
                <SummaryLine icon={MapPinIcon} text={`In person at ${booked.branchName ?? "the clinic"}`} />
              )}
              <div className="flex items-center gap-2 pt-1"><span className="text-muted-foreground">Status</span> <AppointmentStatusBadge status={booked.status} /></div>
            </div>
            {booked.canPayFee && booked.fee ? (
              <div className="mx-auto max-w-sm space-y-2 rounded-md border p-3 text-sm">
                <p className="text-foreground">Pay the consultation fee of {formatCurrency(booked.fee)} now, or at the clinic. If reception declines the request, it&apos;s refunded automatically.</p>
                <PayButton purpose="booking_fee" id={booked.id} label={`Pay ${formatCurrency(booked.fee)} now`} size="default" />
              </div>
            ) : null}
            {booked.status === "pending_approval" && (
              <p className="mx-auto max-w-sm rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                Your appointment isn&apos;t confirmed yet. Reception will review the request, and you&apos;ll see their answer in My Appointments.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {booked.type === "online" ? "Please be ready a few minutes early with a working internet connection." : "Please arrive 10 minutes early."} You can withdraw or change the request from My Appointments until the visit starts.
            </p>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <Button asChild><Link href="/portal/appointments">View my appointments</Link></Button>
              <Button variant="outline" onClick={() => { setBooked(null); setDoctorId(""); setDate(""); setTime(""); setReason(""); setVisitType("in_person"); setSymptoms(""); setOnset(""); setSeverity(""); setAddSymptoms(false); setStep(null); }}>
                Book another
              </Button>
            </div>
          </CardContent>
        </Card>
      </BookingFrame>
    );
  }

  const STEPS: { key: Step; label: string }[] = [
    ...(o.branches.length > 1 ? [{ key: "branch" as const, label: "Branch" }] : []),
    { key: "doctor", label: "Doctor" },
    { key: "time", label: "Date & time" },
    { key: "details", label: "Reason" },
    { key: "review", label: "Review" },
  ];
  const at = STEPS.findIndex((s) => s.key === current);

  return (
    <BookingFrame>
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Booking steps">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === at ? "step" : undefined} className={cn("rounded-full border px-3 py-1", i === at ? "border-primary bg-primary text-primary-foreground" : i < at ? "text-foreground" : "text-muted-foreground")}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {current === "branch" && (
        <Card>
          <CardHeader><CardTitle>Choose a branch</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {o.branches.map((b) => (
              <button key={b.id} type="button" onClick={() => { setBranchId(b.id); setDoctorId(""); setDate(""); setTime(""); setStep("doctor"); }} className={cn("rounded-lg border p-3 text-left hover:bg-muted", b.id === effectiveBranch && "border-primary")}>
                <p className="font-medium text-foreground">{b.name}</p>
                <p className="text-sm text-muted-foreground">{b.addressLine}, {b.city}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {current === "doctor" && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Choose a doctor</CardTitle>
              {branch && <p className="mt-1 text-sm text-muted-foreground">{branch.name}{o.branches.length > 1 && <> · <button type="button" className="text-primary hover:underline" onClick={() => setStep("branch")}>change branch</button></>}</p>}
            </div>
            {specialties.length > 1 && (
              <Select value={specialty} onValueChange={setSpecialty}>
                <SelectTrigger className="w-full sm:w-56" aria-label="Filter by speciality"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All specialities</SelectItem>
                  {specialties.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </CardHeader>
          <CardContent>
            {shownDoctors.length === 0 ? (
              <EmptyState icon={StethoscopeIcon} title="No doctors available here" description="Try another branch or speciality." />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {shownDoctors.map((d) => <DoctorOption key={d.id} d={d} selected={d.id === doctorId} onSelect={() => { setDoctorId(d.id); setVisitType("in_person"); setDate(""); setTime(""); setStep("time"); }} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {current === "time" && doctor && (
        <Card>
          <CardHeader>
            <CardTitle>Choose a date and time</CardTitle>
            <p className="text-sm text-muted-foreground">{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ""} · {branch?.name}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <VisitTypePicker value={visitType} onChange={setVisitType} offersOnline={doctor.offersOnline} branchName={branch?.name ?? null} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <SlotPicker doctorId={doctor.id} branchId={effectiveBranch} date={date} time={time} maxDaysAhead={o.maxDaysAhead} onDate={(d) => { setDate(d); setTime(""); setError(null); }} onTime={(t) => { setTime(t); setError(null); }} />
            <StepButtons onBack={() => setStep("doctor")} onNext={() => setStep("details")} nextDisabled={!date || !time} />
          </CardContent>
        </Card>
      )}

      {current === "details" && (
        <Card>
          <CardHeader><CardTitle>Reason for your visit</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" maxLength={300} placeholder="e.g. Fever and cough for 3 days" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={addSymptoms} onChange={(e) => setAddSymptoms(e.target.checked)} className="h-4 w-4" />
              Tell the doctor about my symptoms now
            </label>
            {addSymptoms && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="symptoms">Symptoms</Label>
                  <Textarea id="symptoms" maxLength={2000} rows={3} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="onset">Started</Label>
                    <Select value={onset} onValueChange={setOnset}>
                      <SelectTrigger id="onset" className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{ONSETS.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="severity">How bad (optional)</Label>
                    <Select value={severity} onValueChange={setSeverity}>
                      <SelectTrigger id="severity" className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{SEVERITIES.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Shared with your clinic as patient-reported information. It isn&apos;t a diagnosis. In an emergency, call your local emergency number.</p>
              </div>
            )}
            <StepButtons onBack={() => setStep("time")} onNext={() => setStep("review")} nextDisabled={!detailsValid} />
          </CardContent>
        </Card>
      )}

      {current === "review" && doctor && (
        <Card>
          <CardHeader><CardTitle>Review and book</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm" data-testid="booking-review">
              <SummaryLine icon={UserIcon} text={`${doctor.name}${doctor.specialty ? ` · ${doctor.specialty}` : ""}`} />
              {visitType === "online" && doctor.offersOnline ? (
                <SummaryLine icon={VideoIcon} text={`Online consultation (video) · booked with ${branch?.name ?? "the clinic"}`} />
              ) : (
                <SummaryLine icon={MapPinIcon} text={`In person at ${branch ? `${branch.name}, ${branch.city}` : "the clinic"}`} />
              )}
              <SummaryLine icon={CalendarDaysIcon} text={`${formatDate(date, "EEEE, dd MMM yyyy")}`} />
              <SummaryLine icon={ClockIcon} text={`${formatTime12h(time)} · about 30 minutes`} />
              <SummaryLine icon={StethoscopeIcon} text={reason.trim()} />
              {doctor.consultationFee > 0 && <SummaryLine icon={WalletIcon} text={`Consultation fee ${formatCurrency(doctor.consultationFee)} — payable at the clinic`} />}
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep("details")} disabled={book.isPending}>Back</Button>
              <Button onClick={submit} disabled={book.isPending}>
                {book.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Confirm booking
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </BookingFrame>
  );
}

function BookingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Book an appointment</h1>
        <p className="text-sm text-muted-foreground">Choose a doctor and a free time. You&apos;ll get a reference straight away.</p>
      </div>
      {children}
    </div>
  );
}

function DoctorOption({ d, selected, onSelect }: { d: PortalBookingDoctor; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={cn("rounded-lg border p-3 text-left hover:bg-muted", selected && "border-primary")} data-testid="doctor-option">
      <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
        {d.name}
        {d.offersOnline && <Badge variant="outline" className="gap-1 font-normal"><VideoIcon className="h-3 w-3" /> Online available</Badge>}
      </p>
      <p className="text-sm text-muted-foreground">{[d.specialty, d.department].filter(Boolean).join(" · ") || "General"}</p>
      <p className="text-xs text-muted-foreground">
        {d.qualifications}{d.experienceYears ? ` · ${d.experienceYears} yrs` : ""}{d.consultationFee > 0 ? ` · ${formatCurrency(d.consultationFee)}` : ""}
      </p>
    </button>
  );
}

function VisitTypePicker({ value, onChange, offersOnline, branchName }: { value: "in_person" | "online"; onChange: (v: "in_person" | "online") => void; offersOnline: boolean; branchName: string | null }) {
  const choices = [
    { value: "in_person" as const, icon: MapPinIcon, label: "In person", hint: branchName ? `At ${branchName}` : "At the clinic", disabled: false },
    { value: "online" as const, icon: VideoIcon, label: "Online", hint: offersOnline ? "Video consultation" : "Not offered by this doctor", disabled: !offersOnline },
  ];
  return (
    <div className="space-y-2">
      <Label>Visit type</Label>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Visit type">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            disabled={c.disabled}
            onClick={() => onChange(c.value)}
            className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50",
              value === c.value ? "border-primary bg-primary/5" : "hover:bg-muted"
            )}
          >
            <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-foreground">{c.label}</span>
              <span className="block text-xs text-muted-foreground">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepButtons({ onBack, onNext, nextDisabled }: { onBack: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <Button variant="outline" onClick={onBack}><ArrowLeftIcon /> Back</Button>
      <Button onClick={onNext} disabled={nextDisabled}>Continue</Button>
    </div>
  );
}

function SummaryLine({ icon: Icon, text }: { icon: typeof UserIcon; text: string }) {
  return (
    <p className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-foreground">{text}</span>
    </p>
  );
}

// --- My appointments ------------------------------------------------------------

const TABS: { value: PortalAppointmentScope; label: string; empty: string }[] = [
  { value: "upcoming", label: "Upcoming", empty: "You have no upcoming appointments." },
  { value: "past", label: "Past", empty: "No past appointments yet." },
  { value: "cancelled", label: "Cancelled & declined", empty: "No cancelled appointments or declined requests." },
  { value: "all", label: "All", empty: "No appointments yet." },
];

export function LivePortalAppointments({ initialTab = "upcoming" }: { initialTab?: PortalAppointmentScope }) {
  const [tab, setTab] = useState<PortalAppointmentScope>(initialTab);
  const [page, setPage] = useState(1);
  const q = usePortalAppointments(tab, page);
  const empty = TABS.find((t) => t.value === tab)!.empty;
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My appointments</h1>
          <p className="text-sm text-muted-foreground">New bookings wait for receptionist approval. You can withdraw, cancel or reschedule until the visit starts.</p>
        </div>
        <Button asChild><Link href="/portal/book"><CalendarPlusIcon /> Book Appointment</Link></Button>
      </div>
      <Tabs value={tab} onValueChange={(v) => { setTab(v as PortalAppointmentScope); setPage(1); }}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <LoadError error={q.error} what="appointments" onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon={CalendarDaysIcon} title="Nothing here" description={empty} action={tab === "upcoming" ? <Button asChild><Link href="/portal/book">Book Appointment</Link></Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="divide-y">{q.data.items.map((a) => <AppointmentRow key={a.id} appt={a} />)}</div>
          {q.data.total > q.data.pageSize && <DataTablePagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} />}
        </div>
      )}
    </div>
  );
}

// --- My health profile ----------------------------------------------------------

const ALLERGY_BADGE: Record<string, string> = {
  HAS_ALLERGIES: "bg-danger/10 text-danger",
  NONE_KNOWN: "bg-success/10 text-success",
  UNKNOWN: "bg-warning/10 text-warning",
  NOT_ANSWERED: "bg-muted text-muted-foreground",
};

export function LivePortalHealthProfile() {
  const onboarding = useOnboarding();
  const record = usePortalRecord();
  const router = useRouter();
  const state = onboarding?.state;
  const personal = state?.personal;
  const medical = state?.medical;
  // Section edits need the personal step saved first (the database refuses otherwise).
  const canEditSections = Boolean(state?.progress.personalSaved);
  const edit = (step: 1 | 2 | 3) => onboarding?.openAt(step, { section: canEditSections });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Health profile</h1>
        <p className="text-sm text-muted-foreground">What you&apos;ve told your clinic, and the record your clinic keeps for you.</p>
      </div>

      {!onboarding ? (
        <ErrorState title="Your health profile couldn't be loaded" description="Please try again. If it keeps happening, contact your clinic." onRetry={() => router.refresh()} />
      ) : (
        <>
          {!state!.completed && (
            <Card className="border-primary/30 bg-primary/5" data-testid="profile-setup">
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{state!.progress.personalSaved ? "Finish setting up your health profile" : "Set up your health profile"}</p>
                  <p className="text-sm text-muted-foreground">A few details help your clinic prepare for your visit. Everything is saved as you go.</p>
                </div>
                <Button onClick={() => onboarding.openAt()}>{state!.progress.personalSaved ? "Continue" : "Start"}</Button>
              </CardContent>
            </Card>
          )}

          <Card data-testid="patient-reported">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">Your answers <Badge variant="outline">Patient-reported</Badge></CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">You can update these at any time. Your clinic reviews them; they don&apos;t change your medical record and aren&apos;t a diagnosis.</p>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Section title="Personal details" onEdit={() => edit(1)} editLabel={state!.progress.personalSaved ? "Edit" : "Add"}>
                {state!.progress.personalSaved ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label="Full name" value={personal?.legalName || "—"} />
                    <Fact label="Date of birth" value={personal?.dateOfBirth ? formatDate(personal.dateOfBirth) : "—"} />
                    <Fact label="Gender" value={labelOf(GENDERS, personal?.gender ?? null) ?? "Not given"} />
                    <Fact label="Phone" value={formatPhone(personal?.phone) || "—"} />
                    <Fact label="Address" value={[personal?.addressLine, personal?.city, personal?.state, personal?.postalCode].filter(Boolean).join(", ") || "—"} className="sm:col-span-2" />
                    <Fact
                      label="Emergency contact"
                      value={personal?.emergencyContactName ? `${personal.emergencyContactName}${personal.emergencyContactRelationship ? ` (${personal.emergencyContactRelationship})` : ""}${personal.emergencyContactPhone ? ` · ${formatPhone(personal.emergencyContactPhone)}` : ""}` : "Not given"}
                      className="sm:col-span-2"
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground">Not filled in yet.</p>
                )}
              </Section>

              <Section title="Allergies" onEdit={() => edit(2)} editLabel={medical ? "Edit" : "Add"} disabled={!canEditSections}>
                {medical ? (
                  <div className="space-y-2" data-testid="allergy-status">
                    <Badge variant="outline" className={cn("border-transparent", ALLERGY_BADGE[medical.allergyStatus])}>{ALLERGY_STATUS_LABEL[medical.allergyStatus]}</Badge>
                    {medical.allergyStatus === "HAS_ALLERGIES" && (
                      <ul className="list-disc space-y-0.5 pl-5">
                        {medical.allergies.map((a) => <li key={a.substance}>{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}</li>)}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Not answered yet.</p>
                )}
              </Section>

              <Section title="Medicines and conditions" onEdit={() => edit(2)} editLabel={medical ? "Edit" : "Add"} disabled={!canEditSections}>
                {medical ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label="Current medicines" value={medical.medications.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ")).join(", ") || "None listed"} />
                    <Fact label="Conditions" value={medical.conditions.join(", ") || "None listed"} />
                  </div>
                ) : (
                  <p className="text-muted-foreground">Not answered yet.</p>
                )}
              </Section>

              <Section title="Surgeries and family history" onEdit={() => edit(2)} editLabel={medical ? "Edit" : "Add"} disabled={!canEditSections}>
                {medical ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label="Past surgeries" value={medical.pastSurgeries || "None listed"} />
                    <Fact label="Family history" value={medical.familyHistory || "None listed"} />
                  </div>
                ) : (
                  <p className="text-muted-foreground">Not answered yet.</p>
                )}
              </Section>

              <Section title="Symptoms before a visit" onEdit={() => edit(3)} editLabel="Send symptoms" disabled={!canEditSections}>
                <p className="text-muted-foreground">
                  {state!.recentSymptomReports
                    ? `You've sent ${state!.recentSymptomReports} symptom update${state!.recentSymptomReports > 1 ? "s" : ""} in the last 30 days. Each one is kept; nothing is overwritten.`
                    : "Tell your doctor how you feel before your next visit. You can link it to an upcoming appointment."}
                </p>
              </Section>
              {!canEditSections && <p className="pt-2 text-xs text-muted-foreground">Add your personal details first — then you can fill in the other sections in any order.</p>}
            </CardContent>
          </Card>
        </>
      )}

      <Card data-testid="clinic-record">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">Clinic record <Badge variant="outline">Kept by your clinic</Badge></CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Recorded by clinic staff and doctors. To correct anything here, please speak to the front desk.</p>
        </CardHeader>
        <CardContent className="text-sm">
          {record.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : record.isError ? (
            <LoadError error={record.error} what="clinic record" onRetry={() => record.refetch()} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Name" value={record.data!.name} />
              <Fact label="Patient no." value={record.data!.patientNumber} />
              <Fact label="Date of birth" value={formatDate(record.data!.dateOfBirth)} />
              <Fact label="Gender" value={GENDER_LABEL[record.data!.gender]} />
              <Fact label="Phone" value={formatPhone(record.data!.phone) || record.data!.phone} />
              <Fact label="Blood group" value={record.data!.bloodGroup ?? "Not recorded"} />
              <Fact label="Allergies (clinic)" value={record.data!.allergies.join(", ") || "None recorded"} />
              <Fact label="Conditions (clinic)" value={record.data!.chronicConditions.join(", ") || "None recorded"} />
              <Fact label="Registered at" value={record.data!.branchName ?? "—"} />
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Diagnoses, prescriptions and lab results are written by your care team and can&apos;t be edited here.</p>
    </div>
  );
}

function Section({ title, onEdit, editLabel = "Edit", disabled = false, children }: { title: string; onEdit: () => void; editLabel?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t py-3 first:border-t-0 first:pt-0" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-foreground">{title}</h3>
        <Button size="sm" variant="outline" onClick={onEdit} disabled={disabled}>{editLabel}</Button>
      </div>
      {children}
    </section>
  );
}

// --- Bills ----------------------------------------------------------------------

function InvoiceRow({ inv }: { inv: PortalInvoice }) {
  const s = INVOICE_STATUS[inv.status];
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3" data-testid="portal-invoice">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{inv.invoiceNumber}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDate(inv.issuedAt)}{inv.branchName ? ` · ${inv.branchName}` : ""}{inv.appointmentDate ? ` · Visit ${formatDate(inv.appointmentDate)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">{formatCurrency(inv.status === "paid" ? inv.total : inv.balance)}</p>
          <Badge variant="outline" className={cn("border-transparent", s.className)}>{s.label}</Badge>
        </div>
        {inv.canPayOnline && <PayButton purpose="invoice" id={inv.id} label="Pay now" />}
      </div>
    </div>
  );
}

export function LivePortalPayments() {
  const [page, setPage] = useState(1);
  const q = usePortalInvoices(page);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Bills & payments</h1>
        <p className="text-sm text-muted-foreground">Your invoices from the clinic and what&apos;s been paid. Pay online where offered, or at the clinic.</p>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <LoadError error={q.error} what="bills" onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title="No bills yet" description="Invoices from your visits will appear here." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="divide-y">{q.data.items.map((i) => <InvoiceRow key={i.id} inv={i} />)}</div>
          {q.data.total > q.data.pageSize && <DataTablePagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} />}
        </div>
      )}
    </div>
  );
}

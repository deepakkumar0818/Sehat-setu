"use client";

import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BarChart3Icon,
  Building2Icon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileSignatureIcon,
  IndianRupeeIcon,
  InboxIcon,
  LinkIcon,
  ReceiptIcon,
  StethoscopeIcon,
  UploadCloudIcon,
  UserPlusIcon,
  UserRoundPlusIcon,
  UsersIcon,
  VideoIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { AppointmentStatusChart } from "@/components/charts/appointment-status-chart";
import { formatCurrency, formatDate, formatTime12h } from "@/lib/format";
import { joinClinicPath } from "@/lib/clinic-join";
import { cn } from "@/lib/utils";
import type { AppointmentStatusCount } from "@/services/analytics";
import type { DashboardAppointment, DashboardData, DashboardPatient, DashboardTeamGroup, QuickActionKey } from "@/server/data/dashboard";

// The live staff dashboard. Every section comes from the clinic database for
// the signed-in member, and appears only when their permissions return it
// (the server leaves it null otherwise): patients, billing, the team, and the
// shortcuts they may use. A doctor with only their own schedule sees "My …".
// Panels are plain bordered boxes rather than <Card>, for a denser layout
// than Card's built-in padding and gaps.

type Tone = "primary" | "success" | "ai" | "danger" | "warning" | "info";

const TONE: Record<Tone, { tile: string; chip: string; text: string }> = {
  primary: { tile: "bg-accent/50 hover:bg-accent", chip: "bg-accent", text: "text-primary" },
  success: { tile: "bg-success-muted/40 hover:bg-success-muted", chip: "bg-success-muted", text: "text-success" },
  ai: { tile: "bg-ai-muted/40 hover:bg-ai-muted", chip: "bg-ai-muted", text: "text-ai" },
  danger: { tile: "bg-danger-muted/40 hover:bg-danger-muted", chip: "bg-danger-muted", text: "text-danger" },
  warning: { tile: "bg-warning-muted/40 hover:bg-warning-muted", chip: "bg-warning-muted", text: "text-warning" },
  info: { tile: "bg-info-muted/40 hover:bg-info-muted", chip: "bg-info-muted", text: "text-info" },
};

const ACTIONS: Record<QuickActionKey, { label: string; href: string; icon: LucideIcon; tone: Tone }> = {
  add_patient: { label: "Add Patient", href: "/patients?new=1", icon: UserPlusIcon, tone: "primary" },
  book_appointment: { label: "Book Appointment", href: "/appointments?new=1", icon: CalendarPlusIcon, tone: "info" },
  booking_requests: { label: "Booking Requests", href: "/appointments", icon: InboxIcon, tone: "warning" },
  waiting_room: { label: "Waiting Room", href: "/waiting-room", icon: CalendarClockIcon, tone: "success" },
  consultations: { label: "Consultations", href: "/consultations", icon: StethoscopeIcon, tone: "success" },
  prescriptions: { label: "Prescriptions", href: "/prescriptions", icon: FileSignatureIcon, tone: "danger" },
  upload_report: { label: "Upload Report", href: "/reports", icon: UploadCloudIcon, tone: "info" },
  add_doctor: { label: "Add Doctor", href: "/doctor-roster?invite=1", icon: StethoscopeIcon, tone: "success" },
  add_receptionist: { label: "Add Receptionist", href: "/staff?invite=RECEPTIONIST", icon: UserRoundPlusIcon, tone: "danger" },
  add_nurse: { label: "Add Nurse", href: "/staff?invite=NURSE", icon: UserRoundPlusIcon, tone: "ai" },
  billing: { label: "Billing", href: "/billing", icon: ReceiptIcon, tone: "primary" },
  expenses: { label: "Expenses", href: "/expenses", icon: WalletIcon, tone: "warning" },
  analytics: { label: "Analytics", href: "/analytics", icon: BarChart3Icon, tone: "ai" },
  add_branch: { label: "Add Branch", href: "/clinic/branches", icon: Building2Icon, tone: "warning" },
  patient_link: { label: "Copy Patient Link", href: "/settings", icon: LinkIcon, tone: "primary" },
};

const STAFF_ROLE_LABEL: Record<string, string> = { ADMINISTRATOR: "Administrator", CLINIC_MANAGER: "Clinic manager", RECEPTIONIST: "Receptionist", NURSE: "Nurse" };

/** A bordered panel without Card's built-in padding. */
function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-xl border bg-card shadow-sm", className)}>{children}</section>;
}

/** Percent change, rounded; null when there's no base to compare with. */
function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

function Trend({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <div className="shrink-0 text-right">
      <p className={cn("flex items-center justify-end gap-0.5 text-sm font-semibold", up ? "text-success" : "text-danger")}>
        {up ? <ArrowUpIcon className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden />}
        {Math.abs(value)}%
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone, trend, href }: { label: string; value: string; sub?: string; icon: LucideIcon; tone: Tone; trend?: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="block rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", TONE[tone].chip, TONE[tone].text)}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold leading-tight tracking-tight text-foreground">{value}</p>
        </div>
        {trend}
      </div>
      {sub && <p className="mt-2 truncate text-xs text-muted-foreground">{sub}</p>}
    </Link>
  );
}

function PanelHeader({ title, description, href }: { title: string; description?: string; href?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
          View all <ArrowRightIcon className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function QuickActions({ actions, clinicCode, pendingRequests }: { actions: QuickActionKey[]; clinicCode: string | null; pendingRequests: number | null }) {
  if (actions.length === 0) return null;
  async function copyLink() {
    if (!clinicCode) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${joinClinicPath(clinicCode)}`);
      toast.success("Patient registration & booking link copied.");
    } catch {
      toast.error("Couldn't copy. Find the link in Settings.");
    }
  }
  return (
    <Panel>
      <PanelHeader title="Quick actions" description="Shortcuts for what your role can do" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 px-4 pb-4">
        {actions.map((key) => {
          const a = ACTIONS[key];
          const tile = cn(
            "relative flex flex-col items-center justify-center gap-2 rounded-lg px-2 py-3 text-center text-xs font-medium text-foreground transition-colors",
            TONE[a.tone].tile
          );
          const content = (
            <>
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-card shadow-sm", TONE[a.tone].text)}>
                <a.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="leading-tight">{a.label}</span>
              {key === "booking_requests" && Boolean(pendingRequests) && (
                <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-warning px-1.5 text-[11px] font-semibold leading-5 text-white">{pendingRequests}</span>
              )}
            </>
          );
          return key === "patient_link" && clinicCode ? (
            <button key={key} type="button" onClick={copyLink} className={tile}>{content}</button>
          ) : (
            <Link key={key} href={a.href} className={tile}>{content}</Link>
          );
        })}
      </div>
    </Panel>
  );
}

const TH = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground first:pl-4";
const TD = "px-3 py-2.5 first:pl-4";

function RecentPatients({ rows, own }: { rows: DashboardPatient[]; own: boolean }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={own ? "My recent patients" : "Recent patients"} href="/patients" />
      {rows.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No patients yet" className="m-4 mt-0 py-8" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40">
              <tr>
                <th className={TH}>Patient</th>
                <th className={TH}>Age / Gender</th>
                <th className={TH}>Last visit</th>
                <th className={TH}>Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className={TD}>
                    <Link href={`/patients/${p.id}`} className="flex items-center gap-2.5">
                      <PersonAvatar name={p.name} color={p.avatarColor} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{p.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{p.patientNumber}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={cn(TD, "whitespace-nowrap capitalize text-muted-foreground")}>{p.age} yrs · {p.gender}</td>
                  <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{p.lastVisit ? formatDate(p.lastVisit) : "—"}</td>
                  <td className={TD}><StatusBadge status={p.status} /></td>
                  <td className="pr-3">
                    <Link href={`/patients/${p.id}`} aria-label={`Open ${p.name}`}><ChevronRightIcon className="h-4 w-4 text-muted-foreground" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function UpcomingAppointments({ rows, own }: { rows: DashboardAppointment[]; own: boolean }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={own ? "My upcoming appointments" : "Upcoming appointments"} href="/appointments" />
      {rows.length === 0 ? (
        <EmptyState icon={CalendarDaysIcon} title="Nothing coming up" description="No appointments in the next 14 days." className="m-4 mt-0 py-8" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40">
              <tr>
                <th className={TH}>Time</th>
                <th className={TH}>Patient</th>
                {!own && <th className={TH}>Doctor</th>}
                <th className={TH}>Type</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-muted/30">
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <span className="block font-medium text-foreground">{formatTime12h(a.time)}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatDate(a.date, "dd MMM")}</span>
                  </td>
                  <td className={cn(TD, "font-medium text-foreground")}>{a.patientName}</td>
                  {!own && <td className={cn(TD, "text-muted-foreground")}>{a.doctorName}</td>}
                  <td className={cn(TD, "whitespace-nowrap capitalize text-muted-foreground")}>
                    <span className="inline-flex items-center gap-1">
                      {a.type === "online" && <VideoIcon className="h-3.5 w-3.5" aria-hidden />}
                      {a.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className={TD}><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function TeamCard({ title, href, group, inactiveLabel }: { title: string; href: string; group: DashboardTeamGroup; inactiveLabel: string }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} description={`${group.total} in total`} href={href} />
      {group.items.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-xs text-muted-foreground">None added yet</p>
      ) : (
        <ul className="divide-y border-t">
          {group.items.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 px-4 py-2">
              <PersonAvatar name={p.name} color={p.avatarColor} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{STAFF_ROLE_LABEL[p.detail] ?? p.detail}</p>
              </div>
              <StatusBadge status={p.status} label={p.status === "inactive" ? inactiveLabel : undefined} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function LiveDashboard({ data, greeting, name, today }: { data: DashboardData; greeting: string; name: string; today: string }) {
  const own = data.scope === "own";
  const scopeLabel = [data.clinicName, data.branchName].filter(Boolean).join(" · ");
  const hasStatus = data.statusBreakdown.length > 0;
  const trend = data.billing?.revenueTrend ?? [];
  const yesterday = trend.length > 1 ? trend[trend.length - 2].revenue : 0;
  const team = data.team;
  const teamCards = team
    ? [
        { title: "Doctors", href: "/doctor-roster", group: team.doctors, inactiveLabel: "Suspended" },
        team.nurses && { title: "Nurses", href: "/staff", group: team.nurses, inactiveLabel: "Blocked" },
        team.receptionists && { title: "Receptionists", href: "/staff", group: team.receptionists, inactiveLabel: "Blocked" },
        team.management && { title: "Admins & managers", href: "/staff", group: team.management, inactiveLabel: "Blocked" },
      ].filter((c): c is { title: string; href: string; group: DashboardTeamGroup; inactiveLabel: string } => Boolean(c))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <GreetingHeader
          greeting={greeting}
          name={name}
          subtitle={own ? `Your schedule and patients at ${scopeLabel}.` : `Here's what's happening at ${scopeLabel} today.`}
        />
        <p className="text-sm text-muted-foreground">{formatDate(today, "EEE, dd MMM yyyy")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.totalPatients !== null && (
          <Kpi
            label={own ? "My Patients" : "Total Patients"}
            value={data.totalPatients.toLocaleString("en-IN")}
            sub={data.patientsAtMonthStart !== null ? `${(data.totalPatients - data.patientsAtMonthStart).toLocaleString("en-IN")} new this month` : undefined}
            icon={UsersIcon}
            tone="primary"
            href="/patients"
            trend={data.patientsAtMonthStart !== null && <Trend value={change(data.totalPatients, data.patientsAtMonthStart)} label="vs last month" />}
          />
        )}
        <Kpi
          label={own ? "My Appointments Today" : "Today's Appointments"}
          value={String(data.today.total)}
          sub={`${data.today.completed} completed · ${data.today.waiting} waiting · ${data.today.upcoming} upcoming`}
          icon={CalendarDaysIcon}
          tone="ai"
          href="/appointments"
        />
        {own ? (
          <Kpi label="Waiting Now" value={String(data.today.waiting)} sub={`${data.today.online} online today`} icon={CalendarClockIcon} tone="warning" href="/waiting-room" />
        ) : (
          <Kpi
            label="Active Doctors"
            value={String(data.activeDoctors)}
            sub={data.inactiveDoctors > 0 ? `${data.inactiveDoctors} suspended` : "All doctors active"}
            icon={StethoscopeIcon}
            tone="success"
            href="/doctor-roster"
          />
        )}
        {data.billing ? (
          <Kpi
            label="Today's Revenue"
            value={formatCurrency(data.billing.todaysRevenue)}
            sub={`${formatCurrency(data.billing.outstanding)} outstanding`}
            icon={IndianRupeeIcon}
            tone="warning"
            href="/billing"
            trend={<Trend value={change(data.billing.todaysRevenue, yesterday)} label="vs yesterday" />}
          />
        ) : data.pendingRequests !== null ? (
          <Kpi label="Booking Requests" value={String(data.pendingRequests)} sub="Waiting for approval" icon={InboxIcon} tone="warning" href="/appointments" />
        ) : (
          <Kpi label="Upcoming (14 days)" value={String(data.upcomingNext14Days)} sub={`${data.today.online} online today`} icon={ClipboardListIcon} tone="info" href="/appointments" />
        )}
      </div>

      <QuickActions actions={data.quickActions} clinicCode={data.clinicCode} pendingRequests={data.pendingRequests} />

      <div className={cn("grid grid-cols-1 gap-4", data.recentPatients && "xl:grid-cols-2")}>
        {data.recentPatients && <RecentPatients rows={data.recentPatients} own={own} />}
        <UpcomingAppointments rows={data.upcomingAppointments} own={own} />
      </div>

      {teamCards.length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", teamCards.length >= 4 ? "xl:grid-cols-4" : teamCards.length === 3 ? "xl:grid-cols-3" : "")}>
          {teamCards.map((c) => <TeamCard key={c.title} {...c} />)}
        </div>
      )}

      {(data.billing || hasStatus) && (
        <div className={cn("grid grid-cols-1 gap-4", data.billing && "xl:grid-cols-3")}>
          {data.billing && (
            <Panel className="xl:col-span-2">
              <PanelHeader
                title="Revenue trend"
                description={`Successful payments, last 30 days · ${formatCurrency(data.billing.monthRevenue)} this month · ${data.billing.invoiceCounts.paid} paid, ${data.billing.invoiceCounts.partiallyPaid} partially paid, ${data.billing.invoiceCounts.pending} pending invoices`}
              />
              <div className="px-4 pb-4">
                <RevenueTrendChart data={data.billing.revenueTrend} />
              </div>
            </Panel>
          )}
          <Panel>
            <PanelHeader title="Appointment status" description="Last 30 days and next 14 days" />
            <div className="px-4 pb-4">
              {hasStatus ? <AppointmentStatusChart data={data.statusBreakdown as AppointmentStatusCount[]} /> : <EmptyState title="No appointments in this period" className="border-0 py-8" />}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

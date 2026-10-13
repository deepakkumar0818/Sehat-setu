"use client";

import Link from "next/link";
import { BanknoteIcon, CalendarCheck2Icon, CalendarDaysIcon, CheckCircle2Icon, ClockIcon, StethoscopeIcon, UsersIcon, VideoIcon, WalletIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { AppointmentStatusChart } from "@/components/charts/appointment-status-chart";
import { formatCurrency, formatDate, formatTime12h } from "@/lib/format";
import type { AppointmentStatusCount } from "@/services/analytics";
import type { DashboardAppointment, DashboardData } from "@/server/data/dashboard";

/** Read-only appointment list for database-backed data (no mock-store actions). */
function LiveAppointmentsTable({ rows, showDate, showDoctor, empty }: { rows: DashboardAppointment[]; showDate?: boolean; showDoctor: boolean; empty: string }) {
  const columns: DataTableColumn<DashboardAppointment>[] = [
    ...(showDate ? [{ key: "date", header: "Date", render: (a: DashboardAppointment) => formatDate(a.date) }] : []),
    { key: "time", header: "Time", render: (a) => <span className="font-medium">{formatTime12h(a.time)}</span> },
    {
      key: "patient",
      header: "Patient",
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{a.patientName}</p>
          {a.patientNumber && <p className="text-xs text-muted-foreground">{a.patientNumber}</p>}
        </div>
      ),
    },
    ...(showDoctor ? [{ key: "doctor", header: "Doctor", render: (a: DashboardAppointment) => a.doctorName }] : []),
    { key: "branch", header: "Branch", render: (a) => <span className="text-muted-foreground">{a.branchName}</span> },
    {
      key: "type",
      header: "Type",
      render: (a) => (
        <span className="inline-flex items-center gap-1 capitalize text-muted-foreground">
          {a.type === "online" && <VideoIcon className="h-3.5 w-3.5" />}
          {a.type.replace("_", " ")}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} emptyState={<EmptyState icon={CalendarDaysIcon} title={empty} className="border-0 py-10" />} />;
}

export function LiveDashboard({ data, greeting, name }: { data: DashboardData; greeting: string; name: string }) {
  const own = data.scope === "own";
  const scopeLabel = [data.clinicName, data.branchName].filter(Boolean).join(" · ");
  const hasStatus = data.statusBreakdown.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <GreetingHeader
          greeting={greeting}
          name={name}
          subtitle={own ? `Your schedule and patients at ${scopeLabel}.` : `Here's what's happening at ${scopeLabel} today.`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.totalPatients !== null && (
          <StatCard label={own ? "My Patients" : "Total Patients"} value={data.totalPatients.toLocaleString("en-IN")} icon={UsersIcon} />
        )}
        <StatCard label={own ? "My Appointments Today" : "Today's Appointments"} value={String(data.today.total)} icon={CalendarDaysIcon} />
        <StatCard label="Waiting (checked in)" value={String(data.today.waiting)} icon={ClockIcon} tone={data.today.waiting > 5 ? "warning" : "default"} />
        <StatCard label="Completed Today" value={String(data.today.completed)} icon={CheckCircle2Icon} />
        <StatCard label="Online Today" value={String(data.today.online)} icon={VideoIcon} />
        <StatCard label="Upcoming (14 days)" value={String(data.upcomingNext14Days)} icon={CalendarCheck2Icon} />
        {!own && <StatCard label="Active Doctors" value={String(data.activeDoctors)} icon={StethoscopeIcon} />}
        {data.billing && (
          <>
            <StatCard label="Today's Revenue" value={formatCurrency(data.billing.todaysRevenue)} icon={BanknoteIcon} />
            <StatCard
              label="Outstanding Payments"
              value={formatCurrency(data.billing.outstanding)}
              icon={WalletIcon}
              tone={data.billing.outstanding > 0 ? "warning" : "default"}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {data.billing && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue trend</CardTitle>
                <CardDescription>
                  Successful payments, last 30 days · {formatCurrency(data.billing.monthRevenue)} this month · {data.billing.invoiceCounts.paid} paid,{" "}
                  {data.billing.invoiceCounts.partiallyPaid} partially paid, {data.billing.invoiceCounts.pending} pending invoices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RevenueTrendChart data={data.billing.revenueTrend} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{own ? "My appointments today" : "Today's appointments"}</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/appointments">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <LiveAppointmentsTable rows={data.todaysAppointments} showDoctor={!own} empty="No appointments scheduled for today" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Appointment status</CardTitle>
            <CardDescription>Last 30 days and next 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            {hasStatus ? (
              <AppointmentStatusChart data={data.statusBreakdown as AppointmentStatusCount[]} />
            ) : (
              <EmptyState title="No appointments in this period" className="border-0 py-10" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent appointments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LiveAppointmentsTable rows={data.recentAppointments} showDate showDoctor={!own} empty="No past appointments yet" />
        </CardContent>
      </Card>
    </div>
  );
}

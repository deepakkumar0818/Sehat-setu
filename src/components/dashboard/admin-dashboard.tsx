"use client";

import Link from "next/link";
import {
  BanknoteIcon,
  CalendarDaysIcon,
  ClockIcon,
  FlaskConicalIcon,
  PackageXIcon,
  UsersIcon,
  VideoIcon,
  WalletIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { StatCard } from "@/components/shared/stat-card";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { PatientGrowthChart } from "@/components/charts/patient-growth-chart";
import { AppointmentStatusChart } from "@/components/charts/appointment-status-chart";
import { DoctorPerformanceList } from "@/components/charts/doctor-performance-list";
import { AIInsightsPanel } from "@/components/ai/ai-insights-panel";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { formatCurrency } from "@/lib/format";
import { getGreetingName } from "@/lib/auth";
import type { AuthUser } from "@/types";
import {
  useAppointmentStatusBreakdown,
  useDashboardKpis,
  useDoctorPerformance,
  usePatientGrowth,
  useRevenueTrend,
} from "@/hooks/use-analytics";
import { useTodaysAppointments } from "@/hooks/use-appointments";
import { useUiStore } from "@/store/ui-store";

export function AdminDashboard({ user }: { user: AuthUser }) {
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const branchId = activeBranchId ?? undefined;
  const { data: kpis, isLoading: kpisLoading } = useDashboardKpis(branchId);
  const { data: revenueTrend, isLoading: revenueLoading } = useRevenueTrend(30);
  const { data: patientGrowth, isLoading: growthLoading } = usePatientGrowth(10);
  const { data: statusBreakdown, isLoading: statusLoading } = useAppointmentStatusBreakdown(30);
  const { data: doctorPerformance, isLoading: perfLoading } = useDoctorPerformance();
  const { data: todaysAppointments, isLoading: apptsLoading } = useTodaysAppointments(branchId ?? user.branchId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <GreetingHeader name={getGreetingName(user)} subtitle="Here's what's happening at your clinic today." />
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link href="/appointments?new=1">
              <CalendarDaysIcon /> Book appointment
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Patients" value={kpis ? kpis.totalPatients.toLocaleString("en-IN") : "—"} icon={UsersIcon} isLoading={kpisLoading} />
        <StatCard label="Today's Appointments" value={kpis ? String(kpis.todaysAppointments) : "—"} icon={CalendarDaysIcon} isLoading={kpisLoading} />
        <StatCard label="Today's Revenue" value={kpis ? formatCurrency(kpis.todaysRevenue) : "—"} icon={BanknoteIcon} isLoading={kpisLoading} />
        <StatCard
          label="Pending Reports"
          value={kpis ? String(kpis.pendingReports) : "—"}
          icon={FlaskConicalIcon}
          tone={kpis && kpis.pendingReports > 0 ? "warning" : "default"}
          isLoading={kpisLoading}
        />
        <StatCard
          label="Waiting Patients"
          value={kpis ? String(kpis.waitingPatients) : "—"}
          icon={ClockIcon}
          tone={kpis && kpis.waitingPatients > 5 ? "warning" : "default"}
          isLoading={kpisLoading}
        />
        <StatCard label="Online Consultations" value={kpis ? String(kpis.onlineConsultationsToday) : "—"} icon={VideoIcon} isLoading={kpisLoading} />
        <StatCard
          label="Outstanding Payments"
          value={kpis ? formatCurrency(kpis.outstandingPayments) : "—"}
          icon={WalletIcon}
          tone={kpis && kpis.outstandingPayments > 0 ? "warning" : "default"}
          isLoading={kpisLoading}
        />
        <StatCard
          label="Low Stock Medicines"
          value={kpis ? String(kpis.lowStockMedicines) : "—"}
          icon={PackageXIcon}
          tone={kpis && kpis.lowStockMedicines > 0 ? "danger" : "default"}
          isLoading={kpisLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Revenue trend</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueTrendChart data={revenueTrend} isLoading={revenueLoading} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Patient growth</CardTitle>
              <CardDescription>New vs. returning patients, by week</CardDescription>
            </CardHeader>
            <CardContent>
              <PatientGrowthChart data={patientGrowth} isLoading={growthLoading} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <AIInsightsPanel />
          <Card>
            <CardHeader>
              <CardTitle>Appointment status</CardTitle>
            </CardHeader>
            <CardContent>
              <AppointmentStatusChart data={statusBreakdown} isLoading={statusLoading} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Doctor performance</CardTitle>
        </CardHeader>
        <CardContent>
          <DoctorPerformanceList data={doctorPerformance} isLoading={perfLoading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Today&apos;s appointments</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/appointments">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <AppointmentsTable rows={todaysAppointments ?? []} isLoading={apptsLoading} />
        </CardContent>
      </Card>
    </div>
  );
}

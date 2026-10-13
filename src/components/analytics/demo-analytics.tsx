"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { PatientGrowthChart } from "@/components/charts/patient-growth-chart";
import { AppointmentStatusChart } from "@/components/charts/appointment-status-chart";
import { DoctorPerformanceList } from "@/components/charts/doctor-performance-list";
import { AIInsightsPanel } from "@/components/ai/ai-insights-panel";
import { StatCard } from "@/components/shared/stat-card";
import { formatCurrency } from "@/lib/format";
import {
  useAppointmentStatusBreakdown,
  useDashboardKpis,
  useDoctorPerformance,
  usePatientGrowth,
  useRevenueTrend,
} from "@/hooks/use-analytics";
import { useUiStore } from "@/store/ui-store";

// Demo mode only: the original analytics page over the in-browser mock data.
export function DemoAnalytics() {
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const { data: kpis, isLoading: kpisLoading } = useDashboardKpis(activeBranchId ?? undefined);
  const { data: revenueTrend, isLoading: revenueLoading } = useRevenueTrend(30);
  const { data: patientGrowth, isLoading: growthLoading } = usePatientGrowth(10);
  const { data: statusBreakdown, isLoading: statusLoading } = useAppointmentStatusBreakdown(30);
  const { data: doctorPerformance, isLoading: perfLoading } = useDoctorPerformance();

  const totalRevenue30d = revenueTrend?.reduce((s, p) => s + p.revenue, 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Analytics" description="Clinic performance, revenue, and operational insights." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue (30 days)" value={formatCurrency(totalRevenue30d)} isLoading={revenueLoading} />
        <StatCard label="Total Patients" value={kpis ? kpis.totalPatients.toLocaleString("en-IN") : "—"} isLoading={kpisLoading} />
        <StatCard label="Outstanding Payments" value={kpis ? formatCurrency(kpis.outstandingPayments) : "—"} tone={kpis && kpis.outstandingPayments > 0 ? "warning" : "default"} isLoading={kpisLoading} />
        <StatCard label="Low Stock Medicines" value={kpis ? String(kpis.lowStockMedicines) : "—"} tone={kpis && kpis.lowStockMedicines > 0 ? "danger" : "default"} isLoading={kpisLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Revenue trend</CardTitle>
              <CardDescription>Last 30 days</CardDescription>
            </CardHeader>
            <CardContent><RevenueTrendChart data={revenueTrend} isLoading={revenueLoading} /></CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Patient growth</CardTitle>
              <CardDescription>New vs. returning patients, by week</CardDescription>
            </CardHeader>
            <CardContent><PatientGrowthChart data={patientGrowth} isLoading={growthLoading} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Doctor performance</CardTitle></CardHeader>
            <CardContent><DoctorPerformanceList data={doctorPerformance} isLoading={perfLoading} /></CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <AIInsightsPanel />
          <Card>
            <CardHeader>
              <CardTitle>Appointment status</CardTitle>
              <CardDescription>Last 30 days</CardDescription>
            </CardHeader>
            <CardContent><AppointmentStatusChart data={statusBreakdown} isLoading={statusLoading} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

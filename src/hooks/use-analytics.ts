import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import {
  getAppointmentStatusBreakdown,
  getDashboardKpis,
  getDoctorPerformance,
  getPatientGrowth,
  getRevenueTrend,
} from "@/services/analytics";
import { generateClinicInsights } from "@/services/ai";

export function useDashboardKpis(branchId?: string) {
  return useQuery({ queryKey: queryKeys.analytics.kpisForBranch(branchId), queryFn: () => getDashboardKpis(branchId) });
}

export function useRevenueTrend(days = 30) {
  return useQuery({ queryKey: queryKeys.analytics.revenueTrend(days), queryFn: () => getRevenueTrend(days) });
}

export function usePatientGrowth(weeks = 10) {
  return useQuery({ queryKey: queryKeys.analytics.patientGrowth(weeks), queryFn: () => getPatientGrowth(weeks) });
}

export function useAppointmentStatusBreakdown(days = 30) {
  return useQuery({ queryKey: queryKeys.analytics.appointmentStatus(days), queryFn: () => getAppointmentStatusBreakdown(days) });
}

export function useDoctorPerformance() {
  return useQuery({ queryKey: queryKeys.analytics.doctorPerformance, queryFn: getDoctorPerformance });
}

export function useClinicInsights() {
  return useQuery({ queryKey: queryKeys.analytics.insights, queryFn: generateClinicInsights, staleTime: 5 * 60_000 });
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { liveApi, type ReportParams } from "@/lib/live-api";
import type { ReportExportKey } from "@/lib/reports";

// Clinic reports (live staff app only). No mock fallback: an error is shown as an error.

export function useOperationalReport(params: ReportParams, enabled = true) {
  return useQuery({ queryKey: ["reports", "operational", params], queryFn: () => liveApi.reports.operational(params), enabled, placeholderData: (p) => p });
}

export function useFinancialReport(params: ReportParams, enabled = true) {
  return useQuery({ queryKey: ["reports", "financial", params], queryFn: () => liveApi.reports.financial(params), enabled, placeholderData: (p) => p });
}

export function useDownloadReport() {
  return useMutation({ mutationFn: ({ report, params }: { report: ReportExportKey; params: ReportParams }) => liveApi.reports.download(report, params) });
}

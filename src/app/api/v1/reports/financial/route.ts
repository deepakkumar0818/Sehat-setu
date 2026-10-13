import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { getFinancialReport, REPORTS_VIEW } from "@/server/data/reports";

// Also needs a billing permission (checked in getFinancialReport and, for the rows, by RLS).
export const GET = apiRoute({ permission: REPORTS_VIEW, resource: "GET /api/v1/reports/financial" }, ({ ctx, request }) =>
  getFinancialReport(ctx, searchParamsOf(request))
);

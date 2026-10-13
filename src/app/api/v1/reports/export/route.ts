import { fileRoute, searchParamsOf } from "@/server/api/route-handler";
import { exportReport, REPORTS_EXPORT } from "@/server/data/reports";

// CSV download of one report; audited (report, range, branch filter and row count only).
export const GET = fileRoute({ permission: REPORTS_EXPORT, resource: "GET /api/v1/reports/export" }, async ({ ctx, request }) => {
  const file = await exportReport(ctx, searchParamsOf(request));
  return { filename: file.filename, contentType: "text/csv; charset=utf-8", body: file.csv };
});

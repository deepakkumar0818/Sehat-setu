import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { getOperationalReport, REPORTS_VIEW } from "@/server/data/reports";

export const GET = apiRoute({ permission: REPORTS_VIEW, resource: "GET /api/v1/reports/operational" }, ({ ctx, request }) =>
  getOperationalReport(ctx, searchParamsOf(request))
);

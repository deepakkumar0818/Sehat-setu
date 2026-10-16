import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { createLabReport, listLabReports } from "@/server/data/lab-reports";
import { CLINICAL_READ, LAB_REPORT_CREATE } from "@/server/data/document-rules";

export const GET = apiRoute({ permission: [...CLINICAL_READ, ...LAB_REPORT_CREATE], resource: "GET /api/v1/lab-reports" }, ({ ctx, request }) =>
  listLabReports(ctx, searchParamsOf(request))
);

/** Body { patientId, testType, title, consultationId?, branchId? }. */
export const POST = apiRoute({ permission: LAB_REPORT_CREATE, resource: "POST /api/v1/lab-reports" }, async ({ ctx, request }) =>
  createLabReport(ctx, await request.json())
);

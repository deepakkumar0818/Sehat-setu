import { apiRoute } from "@/server/api/route-handler";
import { getLabReport, setLabReportValues } from "@/server/data/lab-reports";
import { CLINICAL_READ, LAB_VALUES_UPDATE } from "@/server/data/document-rules";

export const GET = apiRoute<{ id: string }>({ permission: CLINICAL_READ, resource: "GET /api/v1/lab-reports/[id]" }, ({ ctx, params }) => getLabReport(ctx, params.id));

/** Body { values: [{parameter, value?, unit?, range?, flag?}], resultDate?, notes? }. Clears an earlier review. */
export const PATCH = apiRoute<{ id: string }>({ permission: LAB_VALUES_UPDATE, resource: "PATCH /api/v1/lab-reports/[id]" }, async ({ ctx, request, params }) =>
  setLabReportValues(ctx, params.id, await request.json())
);

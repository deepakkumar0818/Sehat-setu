import { apiRoute } from "@/server/api/route-handler";
import { setLabReportShared } from "@/server/data/lab-reports";
import { LAB_REPORT_SHARE } from "@/server/data/document-rules";

export const POST = apiRoute<{ id: string }>({ permission: LAB_REPORT_SHARE, resource: "POST /api/v1/lab-reports/[id]/share" }, ({ ctx, params }) => setLabReportShared(ctx, params.id, true));

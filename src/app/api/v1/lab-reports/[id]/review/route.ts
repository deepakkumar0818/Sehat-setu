import { apiRoute } from "@/server/api/route-handler";
import { reviewLabReport } from "@/server/data/lab-reports";
import { LAB_REPORT_REVIEW } from "@/server/data/document-rules";

export const POST = apiRoute<{ id: string }>({ permission: LAB_REPORT_REVIEW, resource: "POST /api/v1/lab-reports/[id]/review" }, ({ ctx, params }) => reviewLabReport(ctx, params.id));

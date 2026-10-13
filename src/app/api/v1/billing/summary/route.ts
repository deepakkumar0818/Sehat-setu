import { apiRoute } from "@/server/api/route-handler";
import { BILLING_VIEW, getBillingSummary } from "@/server/data/billing";

export const GET = apiRoute({ permission: BILLING_VIEW, resource: "GET /api/v1/billing/summary" }, ({ ctx }) => getBillingSummary(ctx));

import { apiRoute } from "@/server/api/route-handler";
import { BILLING_VIEW, getInvoice } from "@/server/data/billing";

export const GET = apiRoute<{ id: string }>({ permission: BILLING_VIEW, resource: "GET /api/v1/invoices/[id]" }, ({ ctx, params }) => getInvoice(ctx, params.id));

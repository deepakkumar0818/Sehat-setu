import { apiRoute } from "@/server/api/route-handler";
import { PAYMENT_CREATE, recordPayment } from "@/server/data/billing";

export const POST = apiRoute<{ id: string }>({ permission: PAYMENT_CREATE, resource: "POST /api/v1/invoices/[id]/payments" }, async ({ ctx, request, params }) =>
  recordPayment(ctx, params.id, await request.json())
);

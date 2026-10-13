import { apiRoute } from "@/server/api/route-handler";
import { voidInvoice } from "@/server/data/billing";

export const POST = apiRoute<{ id: string }>({ permission: ["invoice.update", "billing.manage"], resource: "POST /api/v1/invoices/[id]/void" }, ({ ctx, params }) =>
  voidInvoice(ctx, params.id)
);

import { apiRoute } from "@/server/api/route-handler";
import { refundPayment } from "@/server/data/billing";

export const POST = apiRoute<{ id: string }>({ permission: ["refund.manage", "billing.manage"], resource: "POST /api/v1/payments/[id]/refund" }, ({ ctx, params }) =>
  refundPayment(ctx, params.id)
);

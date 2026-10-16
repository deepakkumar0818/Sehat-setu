import { apiRoute } from "@/server/api/route-handler";
import { listRefundAttention } from "@/server/data/online-payments";

/** Online refunds that couldn't be completed automatically (to retry). */
export const GET = apiRoute({ permission: ["billing.view", "billing.manage", "refund.manage", "appointment.update"], resource: "GET /api/v1/online-payments/refunds" }, ({ ctx }) =>
  listRefundAttention(ctx)
);

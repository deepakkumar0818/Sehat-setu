import { apiRoute } from "@/server/api/route-handler";
import { retryRefund } from "@/server/data/online-payments";

/** Retry a pending online refund (owed booking fees; any paid order for refund.manage / billing.manage). */
export const POST = apiRoute<{ id: string }>({ permission: ["refund.manage", "billing.manage", "appointment.update"], resource: "POST /api/v1/online-payments/[id]/refund" }, ({ ctx, params }) =>
  retryRefund(ctx, params.id)
);

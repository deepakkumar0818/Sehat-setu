import { platformRoute } from "@/server/api/route-handler";
import { voidSubscriptionPayment } from "@/server/data/platform";

/** Void the clinic's latest payment (recorded by mistake): { reason }. */
export const POST = platformRoute<{ id: string; paymentId: string }>({ resource: "POST /api/v1/platform/clinics/[id]/payments/[paymentId]/void" }, async ({ identity, params, request }) =>
  voidSubscriptionPayment(identity, params.id, params.paymentId, await request.json())
);

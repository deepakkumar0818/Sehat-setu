import { platformRoute } from "@/server/api/route-handler";
import { recordSubscriptionPayment } from "@/server/data/platform";

/** Record money the clinic paid Sehat Setu; extends its paid-until date. */
export const POST = platformRoute<{ id: string }>({ resource: "POST /api/v1/platform/clinics/[id]/payments" }, async ({ identity, params, request }) =>
  recordSubscriptionPayment(identity, params.id, await request.json())
);

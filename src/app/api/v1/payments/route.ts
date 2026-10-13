import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { listPayments, listPaymentsSchema, PAYMENT_VIEW } from "@/server/data/billing";

export const GET = apiRoute({ permission: PAYMENT_VIEW, resource: "GET /api/v1/payments" }, ({ ctx, request }) =>
  listPayments(ctx, listPaymentsSchema.parse(searchParamsOf(request)))
);

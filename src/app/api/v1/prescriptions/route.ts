import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { createPrescription, listPrescriptions, listPrescriptionsSchema, RX_CREATE, RX_VIEW } from "@/server/data/clinical";

export const GET = apiRoute({ permission: RX_VIEW, resource: "GET /api/v1/prescriptions" }, ({ ctx, request }) =>
  listPrescriptions(ctx, listPrescriptionsSchema.parse(searchParamsOf(request)))
);

/** Issue a prescription for a consultation. Assigned doctor only. */
export const POST = apiRoute({ permission: RX_CREATE, resource: "POST /api/v1/prescriptions" }, async ({ ctx, request }) =>
  createPrescription(ctx, await request.json())
);

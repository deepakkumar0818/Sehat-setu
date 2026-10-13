import { apiRoute } from "@/server/api/route-handler";
import { getPrescription, RX_VIEW } from "@/server/data/clinical";

export const GET = apiRoute<{ id: string }>({ permission: RX_VIEW, resource: "GET /api/v1/prescriptions/[id]" }, ({ ctx, params }) =>
  getPrescription(ctx, params.id)
);

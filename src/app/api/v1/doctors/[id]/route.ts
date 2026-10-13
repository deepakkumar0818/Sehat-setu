import { apiRoute } from "@/server/api/route-handler";
import { getDoctor } from "@/server/data/people";

export const GET = apiRoute<{ id: string }>({ permission: [], resource: "GET /api/v1/doctors/[id]" }, ({ ctx, params }) => getDoctor(ctx, params.id));

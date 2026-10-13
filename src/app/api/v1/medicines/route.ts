import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { CATALOG_CREATE, CATALOG_VIEW, createCatalogMedicine, searchCatalog, searchCatalogSchema } from "@/server/data/medicines";

/** Search the shared catalogue: ?search=&page=&pageSize= (≤ 25 per page). */
export const GET = apiRoute({ permission: CATALOG_VIEW, resource: "GET /api/v1/medicines" }, ({ ctx, request }) =>
  searchCatalog(ctx, searchCatalogSchema.parse(searchParamsOf(request)))
);

/** Add a medicine to the shared catalogue (medicine.catalog.create; Administrator). */
export const POST = apiRoute({ permission: CATALOG_CREATE, resource: "POST /api/v1/medicines" }, async ({ ctx, request }) =>
  createCatalogMedicine(ctx, await request.json())
);

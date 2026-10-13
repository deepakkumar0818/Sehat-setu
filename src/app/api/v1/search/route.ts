import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { globalSearch } from "@/server/data/search";

/** Command-palette search; each result section is permission-filtered on the server. */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/search" }, ({ ctx, request }) => globalSearch(ctx, searchParamsOf(request).q ?? ""));

import { apiRoute } from "@/server/api/route-handler";
import { listBranches } from "@/server/data/people";

/** Branches of the caller's clinic (only their own branch if branch-restricted). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/branches" }, ({ ctx }) => listBranches(ctx));

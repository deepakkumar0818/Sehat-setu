import { apiRoute } from "@/server/api/route-handler";
import { listBranches } from "@/server/data/people";
import { BRANCH_CREATE, createBranch } from "@/server/data/clinic-setup";

/** Branches of the caller's clinic (only their own branch if branch-restricted). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/branches" }, ({ ctx }) => listBranches(ctx));

/** Add a branch (branch.create; clinic-wide members only). */
export const POST = apiRoute({ permission: BRANCH_CREATE, resource: "POST /api/v1/branches" }, async ({ ctx, request }) => createBranch(ctx, await request.json()));

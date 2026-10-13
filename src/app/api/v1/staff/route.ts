import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { listStaff, listStaffSchema } from "@/server/data/people";

export const GET = apiRoute({ permission: ["staff.view", "staff.manage", "user.view"], resource: "GET /api/v1/staff" }, ({ ctx, request }) =>
  listStaff(ctx, listStaffSchema.parse(searchParamsOf(request)))
);

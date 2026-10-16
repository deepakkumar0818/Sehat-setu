import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { AUDIT_VIEW, listAuditEvents } from "@/server/data/audit-log";

/** The clinic's audit log, newest first: ?area=&outcome=&search=&page=&pageSize= */
export const GET = apiRoute({ permission: AUDIT_VIEW, resource: "GET /api/v1/audit-events" }, ({ ctx, request }) => listAuditEvents(ctx, searchParamsOf(request)));

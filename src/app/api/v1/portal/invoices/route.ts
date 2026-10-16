import { patientRoute, searchParamsOf } from "@/server/api/route-handler";
import { listMyInvoices } from "@/server/data/portal-booking";

// The signed-in patient's own invoices and what's been paid (read-only).
export const GET = patientRoute({ resource: "GET /api/v1/portal/invoices" }, ({ ctx, request }) => listMyInvoices(ctx, searchParamsOf(request)));

import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { BILLING_VIEW, createInvoiceForAppointment, createManualInvoice, INVOICE_CREATE, listInvoices, listInvoicesSchema } from "@/server/data/billing";

export const GET = apiRoute({ permission: BILLING_VIEW, resource: "GET /api/v1/invoices" }, ({ ctx, request }) =>
  listInvoices(ctx, listInvoicesSchema.parse(searchParamsOf(request)))
);

/** Body { appointmentId } invoices that appointment's consultation; otherwise a manual invoice with line items. */
export const POST = apiRoute({ permission: INVOICE_CREATE, resource: "POST /api/v1/invoices" }, async ({ ctx, request }) => {
  const body: unknown = await request.json();
  if (body && typeof body === "object" && "appointmentId" in body) return createInvoiceForAppointment(ctx, String(body.appointmentId));
  return createManualInvoice(ctx, body);
});

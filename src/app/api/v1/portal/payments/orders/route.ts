import { patientRoute } from "@/server/api/route-handler";
import { startPatientPayment } from "@/server/data/online-payments";

// Start paying a bill or a booking fee: { purpose: "invoice" | "booking_fee", id }. The amount is decided by the database.
export const POST = patientRoute({ resource: "POST /api/v1/portal/payments/orders" }, async ({ ctx, request }) => startPatientPayment(ctx, await request.json()));

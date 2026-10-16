import { patientRoute } from "@/server/api/route-handler";
import { confirmPatientPayment } from "@/server/data/online-payments";

// Razorpay Checkout success callback: recorded only after the signature is verified with our secret.
export const POST = patientRoute({ resource: "POST /api/v1/portal/payments/verify" }, async ({ ctx, request }) => confirmPatientPayment(ctx, await request.json()));

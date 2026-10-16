import { NextResponse, type NextRequest } from "next/server";
import { handleRazorpayWebhook } from "@/server/data/online-payments";
import { logServerError } from "@/server/log";

// Razorpay webhooks (payment.captured, order.paid, refund.processed). No session:
// every request is authenticated by its X-Razorpay-Signature (HMAC of the raw body
// with RAZORPAY_WEBHOOK_SECRET). A repeated event changes nothing.
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 200_000) return NextResponse.json({ ok: false }, { status: 413 });
  try {
    const ok = await handleRazorpayWebhook(body, request.headers.get("x-razorpay-signature"));
    return NextResponse.json({ ok }, { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logServerError("razorpay webhook", err instanceof Error ? err.name : "error");
    return NextResponse.json({ ok: false }, { status: 500 }); // Razorpay retries
  }
}

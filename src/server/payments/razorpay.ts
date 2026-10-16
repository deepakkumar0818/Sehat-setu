import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay (https://razorpay.com/docs/api/) for patient online payments.
// Server-only: the key secret and webhook secret never leave this module and
// are never logged. Card/UPI details never reach this app — Razorpay Checkout
// collects them in its own frame. A payment is trusted only after its HMAC
// signature is verified with our secret (checkout callback or webhook).
//
// Configuration (server environment; see .env.example):
//   RAZORPAY_KEY_ID          rzp_test_… or rzp_live_… (also sent to the browser for Checkout; not secret)
//   RAZORPAY_KEY_SECRET      the key's secret
//   RAZORPAY_WEBHOOK_SECRET  the webhook's secret (Dashboard → Webhooks), for /api/webhooks/razorpay

const API = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  mode: "test" | "live";
}

/** The configuration, or null when online payments aren't set up (the app then offers no "Pay online"). */
export function readRazorpayConfig(env: Record<string, string | undefined> = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret || !/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(keyId) || keySecret.length < 16 || /[<>[\]]|your-/i.test(keySecret)) return null;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;
  return { keyId, keySecret, webhookSecret, mode: keyId.startsWith("rzp_live_") ? "live" : "test" };
}

export const onlinePaymentsConfigured = () => readRazorpayConfig() !== null;

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

function safeEqualHex(expected: string, given: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  return Boolean(signature) && safeEqualHex(hmacHex(webhookSecret, rawBody), signature!);
}

export class RazorpayError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Razorpay request failed (${status} ${code})`);
    this.name = "RazorpayError";
  }
}

type Fetch = typeof fetch;

async function call<T>(config: RazorpayConfig, path: string, body: unknown, fetchImpl: Fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } } & T;
  // Only the status and Razorpay's error code are kept: never the response text or our request.
  if (!res.ok) throw new RazorpayError(res.status, json.error?.code ?? "UNKNOWN");
  return json;
}

/** Creates an order for exactly `amountPaise` (INR). `notes` carry only ids (no names, no medical details). */
export async function createRazorpayOrder(config: RazorpayConfig, input: { amountPaise: number; receipt: string; notes: Record<string, string> }, fetchImpl?: Fetch) {
  const order = await call<{ id: string; amount: number; currency: string; status: string }>(
    config,
    "/orders",
    { amount: input.amountPaise, currency: "INR", receipt: input.receipt.slice(0, 40), notes: input.notes },
    fetchImpl
  );
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(order.id) || order.amount !== input.amountPaise || order.currency !== "INR") throw new RazorpayError(502, "UNEXPECTED_ORDER");
  return order;
}

/** Full refund of a captured payment. */
export async function refundRazorpayPayment(config: RazorpayConfig, input: { paymentId: string; amountPaise: number; notes: Record<string, string> }, fetchImpl?: Fetch) {
  const refund = await call<{ id: string; status: string; amount: number }>(
    config,
    `/payments/${encodeURIComponent(input.paymentId)}/refund`,
    { amount: input.amountPaise, speed: "normal", notes: input.notes },
    fetchImpl
  );
  if (!/^rfnd_[A-Za-z0-9]{6,40}$/.test(refund.id) || refund.status === "failed") throw new RazorpayError(502, "REFUND_NOT_CREATED");
  return refund;
}

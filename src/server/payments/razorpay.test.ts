import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Razorpay client WITHOUT the network: signature checks (the only reason a
// payment is trusted), configuration parsing, and the exact requests sent
// (amount in paise, Basic auth, no personal data in notes) with a fake fetch.

vi.mock("server-only", () => ({}));
const { createRazorpayOrder, readRazorpayConfig, refundRazorpayPayment, RazorpayError, verifyCheckoutSignature, verifyWebhookSignature } = await import("./razorpay");

const SECRET = "test_secret_abcdefghijklmnop";
const config = { keyId: "rzp_test_ABCDEFGH1234", keySecret: SECRET, webhookSecret: "whsec_test_123456", mode: "test" as const };
const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest("hex");

describe("signatures", () => {
  it("checkout: HMAC(order|payment) with the key secret; anything else fails", () => {
    const sig = hmac(SECRET, "order_ABC123456|pay_XYZ987654");
    expect(verifyCheckoutSignature("order_ABC123456", "pay_XYZ987654", sig, SECRET)).toBe(true);
    expect(verifyCheckoutSignature("order_ABC123456", "pay_XYZ987654", sig.toUpperCase(), SECRET)).toBe(true);
    expect(verifyCheckoutSignature("order_ABC123456", "pay_OTHER0000", sig, SECRET)).toBe(false); // swapped payment
    expect(verifyCheckoutSignature("order_OTHER000", "pay_XYZ987654", sig, SECRET)).toBe(false); // swapped order
    expect(verifyCheckoutSignature("order_ABC123456", "pay_XYZ987654", sig, "wrong_secret_000000000")).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123456", "pay_XYZ987654", "abc", SECRET)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC123456", "pay_XYZ987654", "", SECRET)).toBe(false);
  });

  it("webhook: HMAC of the raw body with the webhook secret", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    expect(verifyWebhookSignature(body, hmac("whsec_test_123456", body), "whsec_test_123456")).toBe(true);
    expect(verifyWebhookSignature(body + " ", hmac("whsec_test_123456", body), "whsec_test_123456")).toBe(false); // body changed
    expect(verifyWebhookSignature(body, null, "whsec_test_123456")).toBe(false);
    expect(verifyWebhookSignature(body, hmac(SECRET, body), "whsec_test_123456")).toBe(false); // signed with the wrong secret
  });
});

describe("configuration", () => {
  it("needs a real key id and secret; placeholders and publishable-looking values are refused", () => {
    expect(readRazorpayConfig({})).toBeNull();
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_ABCDEFGH1234" })).toBeNull();
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "your-key", RAZORPAY_KEY_SECRET: SECRET })).toBeNull();
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_ABCDEFGH1234", RAZORPAY_KEY_SECRET: "[your-secret]-padding" })).toBeNull();
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_ABCDEFGH1234", RAZORPAY_KEY_SECRET: SECRET })).toMatchObject({ mode: "test", webhookSecret: null });
    expect(readRazorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_ABCDEFGH1234", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: "w" })?.mode).toBe("live");
  });
});

describe("API calls", () => {
  it("creates an order for exactly the amount (paise, INR) with Basic auth and id-only notes", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ id: "order_NEW1234567", amount: 50000, currency: "INR", status: "created" }), { status: 200 }));
    const order = await createRazorpayOrder(config, { amountPaise: 50000, receipt: "BOOKING_FEE:3333", notes: { purpose: "BOOKING_FEE", ref: "3333" } }, fetchImpl as unknown as typeof fetch);
    expect(order.id).toBe("order_NEW1234567");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(init.body as string)).toEqual({ amount: 50000, currency: "INR", receipt: "BOOKING_FEE:3333", notes: { purpose: "BOOKING_FEE", ref: "3333" } });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`rzp_test_ABCDEFGH1234:${SECRET}`).toString("base64")}`);
  });

  it("refuses an order whose amount or currency differs from what was asked", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "order_NEW1234567", amount: 100, currency: "INR" }), { status: 200 }));
    await expect(createRazorpayOrder(config, { amountPaise: 50000, receipt: "r", notes: {} }, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(RazorpayError);
  });

  it("errors keep only the status and Razorpay's code (no response text, no secret)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: `secret ${SECRET}` } }), { status: 400 }));
    const err = await createRazorpayOrder(config, { amountPaise: 50000, receipt: "r", notes: {} }, fetchImpl as unknown as typeof fetch).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: "BAD_REQUEST_ERROR" });
    expect(String(err.message)).not.toContain(SECRET);
  });

  it("refunds the full amount of one payment", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: "rfnd_ABC1234567", status: "processed", amount: 50000 }), { status: 200 }));
    const refund = await refundRazorpayPayment(config, { paymentId: "pay_XYZ987654", amountPaise: 50000, notes: { order: "order_ABC123456" } }, fetchImpl as unknown as typeof fetch);
    expect(refund.id).toBe("rfnd_ABC1234567");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.razorpay.com/v1/payments/pay_XYZ987654/refund");
    const failed = vi.fn(async () => new Response(JSON.stringify({ id: "rfnd_ABC1234567", status: "failed" }), { status: 200 }));
    await expect(refundRazorpayPayment(config, { paymentId: "pay_XYZ987654", amountPaise: 1, notes: {} }, failed as unknown as typeof fetch)).rejects.toBeInstanceOf(RazorpayError);
  });
});

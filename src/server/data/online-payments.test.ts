import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatientContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";

// The online-payment flow WITHOUT a database or Razorpay: nothing is recorded
// unless Razorpay's signature checks out, the amount comes from the database
// (never the browser), the order must be the patient's own, and the feature is
// simply unavailable without configuration. Database behaviour was verified on
// a throwaway PostgreSQL (see docs/security.md).

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/tenant", () => ({
  withPatientDb: () => {
    throw new Error("no database in unit tests");
  },
  withTenantDb: () => {
    throw new Error("no database in unit tests");
  },
}));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn(), onlinePaymentOrder: { findUnique: vi.fn() } }));
vi.mock("@/server/prisma", () => ({ prisma: prismaMock }));
const fetchMock = vi.fn();

const { confirmPatientPayment, handleRazorpayWebhook, startPatientPayment } = await import("./online-payments");

const SECRET = "test_secret_abcdefghijklmnop";
const ctx: PatientContext = { authUserId: "a", userId: "u", email: "p@example.test", name: "Asha", clinicId: "c1", clinicName: "Aarogya", patientIds: ["pt-1"] };
const APPT = "33333333-3333-4333-8333-333333333333";
const sign = (o: string, p: string) => createHmac("sha256", SECRET).update(`${o}|${p}`).digest("hex");

function fakeTx(found: unknown = { id: "ord-uuid" }, patientOnlinePayments = true) {
  const sql: { text: string; values: unknown[] }[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      sql.push({ text, values });
      if (text.includes("online_payable")) return [{ amount_paise: 50000, label: "Consultation fee" }];
      if (text.includes("complete_online_payment")) return [{ r: "PAID" }];
      return [{}];
    }),
    onlinePaymentOrder: { findFirst: vi.fn(async () => found) },
    clinicSettings: { findFirst: vi.fn(async () => ({ patientOnlinePayments })) },
  };
  return { tx: tx as unknown as TenantTx, sql, raw: tx };
}

beforeEach(() => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_ABCDEFGH1234");
  vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_123456");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("starting a payment", () => {
  it("charges what the database says is due and records exactly that order", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "order_NEW1234567", amount: 50000, currency: "INR" }), { status: 200 }));
    const { tx, sql } = fakeTx();
    const opts = await startPatientPayment(ctx, { purpose: "booking_fee", id: APPT }, tx);
    expect(sql[0]).toMatchObject({ text: expect.stringContaining("app.online_payable"), values: ["BOOKING_FEE", APPT] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).amount).toBe(50000);
    expect(sql[1]).toMatchObject({ text: expect.stringContaining("app.record_online_order"), values: ["BOOKING_FEE", APPT, "order_NEW1234567", 50000] });
    expect(opts).toMatchObject({ keyId: "rzp_test_ABCDEFGH1234", orderId: "order_NEW1234567", amountPaise: 50000, testMode: true, prefill: { name: "Asha" } });
    expect(JSON.stringify(opts)).not.toContain(SECRET);
    // Notes sent to Razorpay carry ids only.
    expect(JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body).notes)).not.toMatch(/Asha|p@example/);
  });

  it("an amount from the browser is not accepted", async () => {
    const { tx } = fakeTx();
    await expect(startPatientPayment(ctx, { purpose: "invoice", id: APPT, amount: 1 }, tx)).rejects.toThrow();
  });

  it("a clinic that takes payments at the counter only refuses before anything is charged", async () => {
    const { tx, sql } = fakeTx(undefined, false);
    await expect(startPatientPayment(ctx, { purpose: "invoice", id: APPT }, tx)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    expect(sql).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without Razorpay configured, online payment is simply unavailable", async () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const { tx, sql } = fakeTx();
    await expect(startPatientPayment(ctx, { purpose: "invoice", id: APPT }, tx)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    expect(sql).toEqual([]);
  });
});

describe("confirming a payment", () => {
  it("records only after a valid signature, for the patient's own order", async () => {
    const { tx, sql } = fakeTx();
    const body = { razorpay_order_id: "order_ABC123456", razorpay_payment_id: "pay_XYZ987654", razorpay_signature: sign("order_ABC123456", "pay_XYZ987654") };
    expect(await confirmPatientPayment(ctx, body, tx)).toEqual({ status: "paid" });
    expect(sql.at(-1)).toMatchObject({ text: expect.stringContaining("app.complete_online_payment"), values: ["order_ABC123456", "pay_XYZ987654"] });
  });

  it("a forged or mismatched signature records nothing", async () => {
    const { tx, sql } = fakeTx();
    const forged = { razorpay_order_id: "order_ABC123456", razorpay_payment_id: "pay_OTHER0000", razorpay_signature: sign("order_ABC123456", "pay_XYZ987654") };
    await expect(confirmPatientPayment(ctx, forged, tx)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(sql).toEqual([]);
  });

  it("someone else's order is not found", async () => {
    const { tx, sql } = fakeTx(null);
    const body = { razorpay_order_id: "order_ABC123456", razorpay_payment_id: "pay_XYZ987654", razorpay_signature: sign("order_ABC123456", "pay_XYZ987654") };
    await expect(confirmPatientPayment(ctx, body, tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sql).toEqual([]);
  });
});

describe("webhook", () => {
  it("refuses a bad or missing signature without touching the database", async () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_XYZ987654", order_id: "order_ABC123456" } } } });
    expect(await handleRazorpayWebhook(body, "00".repeat(32))).toBe(false);
    expect(await handleRazorpayWebhook(body, null)).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("a signed payment.captured completes the order", async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: async () => [{ r: "PAID" }] }));
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_XYZ987654", order_id: "order_ABC123456" } } } });
    const sig = createHmac("sha256", "whsec_test_123456").update(body).digest("hex");
    expect(await handleRazorpayWebhook(body, sig)).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

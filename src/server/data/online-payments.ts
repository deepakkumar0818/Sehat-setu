import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type PatientContext, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import { logServerError } from "@/server/log";
import {
  createRazorpayOrder,
  readRazorpayConfig,
  refundRazorpayPayment,
  RazorpayError,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/server/payments/razorpay";
import type { CheckoutOptions, OnlinePaymentResult, RefundAttention } from "@/lib/live-types";
import { patientCanPayOnline } from "./clinic-settings";
import { runPatientScoped, runScoped } from "./scope";

// Patient online payments (migration 20261031000100). Flow:
//   1. startPatientPayment: the DATABASE computes what's due (app.online_payable),
//      we create a Razorpay order for exactly that, and record it
//      (app.record_online_order re-checks the amount). The browser gets only the
//      order id, amount and our public key id for Razorpay Checkout.
//   2. confirmPatientPayment (checkout callback) or handleRazorpayWebhook: the
//      HMAC signature is verified with our secret, then
//      app.complete_online_payment records it (idempotent).
//   3. Booking fees owed back (declined/withdrawn, or paid twice) are refunded
//      through Razorpay: app.begin_online_refund → Razorpay refund →
//      app.finish_online_refund. A failed refund stays REFUND_PENDING and is
//      listed for staff to retry; a refund.processed webhook also completes it.

const uuid = z.string().uuid();
export const startPaymentSchema = z.object({ purpose: z.enum(["invoice", "booking_fee"]), id: uuid }).strict();
export const confirmPaymentSchema = z
  .object({
    razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
    razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict();

export const REFUND_MANAGE = ["refund.manage", "billing.manage"] as const;

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  NOTHING_DUE: ["INVALID_TRANSITION", "Nothing is due on this bill."],
  NOT_PAYABLE: ["INVALID_TRANSITION", "This appointment can no longer be paid online."],
  ALREADY_PAID: ["DUPLICATE", "This has already been paid."],
  AMOUNT_CHANGED: ["CONFLICT", "The amount due just changed. Please try again."],
  NOT_REFUNDABLE: ["INVALID_TRANSITION", "This payment can't be refunded."],
  CONFLICT: ["CONFLICT", "This order was already settled with another payment."],
  INVALID_INPUT: ["INVALID_INPUT", "Invalid payment details."],
};

/** 'online payment: CODE' database refusals as API errors. */
function mapPaymentError(err: unknown): never {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  const code = /online payment: ([A-Z_]+)/.exec(parts.join(" | "))?.[1];
  if (code === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  if (code === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  const m = code ? MESSAGES[code] : undefined;
  if (m) throw new DataError(m[0], m[1]);
  throw err;
}

async function sql<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapPaymentError(err);
  }
}

function configOrUnavailable() {
  const config = readRazorpayConfig();
  if (!config) throw new DataError("FEATURE_UNAVAILABLE", "Online payment isn't set up yet. Please pay at the clinic.");
  return config;
}

const DB_PURPOSE = { invoice: "INVOICE", booking_fee: "BOOKING_FEE" } as const;

/** The runtime client, loaded on first use (keeps this module importable without a database, e.g. in unit tests). */
async function runtimeDb() {
  return (await import("@/server/prisma")).prisma;
}

// --- 1. Start ----------------------------------------------------------------------

export async function startPatientPayment(ctx: PatientContext, raw: unknown, db?: TenantTx): Promise<CheckoutOptions> {
  const config = configOrUnavailable();
  const input = startPaymentSchema.parse(raw);
  const purpose = DB_PURPOSE[input.purpose];
  const due = await runPatientScoped(ctx, db, async (tx) => {
    // The clinic may take payments at the counter only (Settings → Online booking).
    if (!(await patientCanPayOnline(tx))) throw new DataError("FEATURE_UNAVAILABLE", "This clinic takes payments at the clinic only.");
    return sql(async () => (await tx.$queryRaw<{ amount_paise: number; label: string }[]>`SELECT amount_paise, label FROM app.online_payable(${purpose}, ${input.id}::uuid)`)[0]);
  });
  let orderId: string;
  try {
    // Notes: ids only — never names or anything medical.
    const order = await createRazorpayOrder(config, { amountPaise: due.amount_paise, receipt: `${purpose}:${input.id}`.slice(0, 40), notes: { purpose, ref: input.id, clinic: ctx.clinicId } });
    orderId = order.id;
  } catch (err) {
    logServerError("razorpay create order", err instanceof RazorpayError ? `${err.status} ${err.code}` : err);
    throw new DataError("UNAVAILABLE", "Couldn't start the payment. Please try again in a moment.");
  }
  await runPatientScoped(ctx, db, (tx) =>
    sql(() => tx.$queryRaw`SELECT app.record_online_order(${purpose}, ${input.id}::uuid, ${orderId}, ${due.amount_paise}::int)`)
  );
  return {
    keyId: config.keyId,
    orderId,
    amountPaise: due.amount_paise,
    currency: "INR",
    name: ctx.clinicName,
    description: due.label,
    prefill: { name: ctx.name, email: ctx.email },
    testMode: config.mode === "test",
  };
}

// --- 2. Complete ------------------------------------------------------------------

async function completeOrder(tx: TenantTx, orderId: string, paymentId: string): Promise<"PAID" | "ALREADY_PAID" | "PAID_NEEDS_REFUND"> {
  const rows = await sql(() => tx.$queryRaw<{ r: "PAID" | "ALREADY_PAID" | "PAID_NEEDS_REFUND" }[]>`SELECT app.complete_online_payment(${orderId}, ${paymentId}) AS r`);
  return rows[0].r;
}

/** Checkout callback from the patient's browser. Trusted only after the signature check. */
export async function confirmPatientPayment(ctx: PatientContext, raw: unknown, db?: TenantTx): Promise<OnlinePaymentResult> {
  const config = configOrUnavailable();
  const input = confirmPaymentSchema.parse(raw);
  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, config.keySecret)) {
    throw new DataError("INVALID_INPUT", "The payment couldn't be verified. If money was taken, it will be confirmed automatically or refunded.");
  }
  const result = await runPatientScoped(ctx, db, async (tx) => {
    // The order must be one of this patient's own (RLS + explicit filter).
    const own = await tx.onlinePaymentOrder.findFirst({ where: { providerOrderId: input.razorpay_order_id, clinicId: ctx.clinicId, patientId: { in: ctx.patientIds } }, select: { id: true } });
    if (!own) throw new AuthError("NOT_FOUND");
    return { orderUuid: own.id, status: await completeOrder(tx, input.razorpay_order_id, input.razorpay_payment_id) };
  });
  if (result.status === "PAID_NEEDS_REFUND") await refundOwedOrder(result.orderUuid, "Booking no longer open", { patient: ctx });
  return { status: result.status === "PAID_NEEDS_REFUND" ? "refunded" : "paid" };
}

/** POST /api/webhooks/razorpay. Returns false for a bad signature (the route answers 400). */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null): Promise<boolean> {
  const config = readRazorpayConfig();
  if (!config?.webhookSecret) return false;
  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) return false;
  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string } }; refund?: { entity?: { id?: string; payment_id?: string } } };
  };
  const prisma = await runtimeDb();
  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;
  if ((event.event === "payment.captured" || event.event === "order.paid") && payment?.id && payment.order_id) {
    try {
      const status = await prisma.$transaction((tx) => completeOrder(tx as unknown as TenantTx, payment.order_id!, payment.id!));
      if (status === "PAID_NEEDS_REFUND") {
        const order = await prisma.onlinePaymentOrder.findUnique({ where: { providerOrderId: payment.order_id }, select: { id: true } });
        if (order) await refundOwedOrder(order.id, "Booking no longer open", {});
      }
    } catch (err) {
      // Not one of our orders (another integration on the same account), or already settled differently:
      // acknowledge so Razorpay stops retrying; real database failures still answer 500 (retried).
      if (err instanceof DataError) logServerError("razorpay payment webhook", err.code);
      else if (!(err instanceof AuthError)) throw err;
    }
  } else if (event.event === "refund.processed" && refund?.id && refund.payment_id) {
    try {
      await prisma.$transaction((tx) => tx.$queryRaw`SELECT app.finish_online_refund(${refund.payment_id}, ${refund.id})`);
    } catch (err) {
      logServerError("razorpay refund webhook", err instanceof Error ? err.name : err);
    }
  }
  return true;
}

// --- 3. Refunds -------------------------------------------------------------------

type RefundCaller = { staff?: TenantContext; patient?: PatientContext };

/**
 * Refunds one paid order through Razorpay. Never throws: a failure leaves the
 * order REFUND_PENDING (listed for staff to retry) and returns false.
 */
export async function refundOwedOrder(orderUuid: string, reason: string, caller: RefundCaller): Promise<boolean> {
  const config = readRazorpayConfig();
  if (!config) return false;
  try {
    const prisma = await runtimeDb();
    const begin = async (tx: TenantTx) =>
      (await tx.$queryRaw<{ provider_payment_id: string; amount_paise: number; provider_order_id: string }[]>`
        SELECT * FROM app.begin_online_refund(${orderUuid}::uuid, ${reason})`)[0];
    const due = caller.staff
      ? await runScoped(caller.staff, undefined, begin)
      : caller.patient
        ? await runPatientScoped(caller.patient, undefined, begin)
        : await prisma.$transaction((tx) => begin(tx as unknown as TenantTx));
    const refund = await refundRazorpayPayment(config, { paymentId: due.provider_payment_id, amountPaise: due.amount_paise, notes: { order: due.provider_order_id } });
    await prisma.$transaction((tx) => tx.$queryRaw`SELECT app.finish_online_refund(${due.provider_payment_id}, ${refund.id})`);
    return true;
  } catch (err) {
    logServerError("online refund", err instanceof RazorpayError ? `${err.status} ${err.code}` : err instanceof Error ? err.name : err);
    return false;
  }
}

/** After a booking request is declined or withdrawn: refund every paid booking fee for it. */
export async function refundBookingFees(appointmentId: string, reason: string, caller: RefundCaller): Promise<{ refunded: number; pending: number }> {
  const read = async (tx: TenantTx) =>
    tx.onlinePaymentOrder.findMany({ where: { appointmentId, purpose: "BOOKING_FEE", status: { in: ["PAID", "REFUND_PENDING"] } }, select: { id: true } });
  const orders = caller.staff ? await runScoped(caller.staff, undefined, read) : caller.patient ? await runPatientScoped(caller.patient, undefined, read) : [];
  let refunded = 0;
  for (const o of orders) if (await refundOwedOrder(o.id, reason, caller)) refunded++;
  return { refunded, pending: orders.length - refunded };
}

/** Refunds stuck in REFUND_PENDING (Razorpay unreachable or refused), for billing staff to retry. */
export async function listRefundAttention(ctx: TenantContext, db?: TenantTx): Promise<{ items: RefundAttention[] }> {
  requirePermission(ctx, ["billing.view", "billing.manage", "refund.manage", "appointment.update"]);
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.onlinePaymentOrder.findMany({
      where: { clinicId: ctx.clinicId, status: "REFUND_PENDING", ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
      orderBy: { refundRequestedAt: "asc" },
      take: 50,
      select: { id: true, amountPaise: true, purpose: true, refundReason: true, refundRequestedAt: true, patient: { select: { name: true, patientNumber: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        amount: r.amountPaise / 100,
        purpose: r.purpose === "BOOKING_FEE" ? "booking_fee" : "invoice",
        reason: r.refundReason,
        requestedAt: r.refundRequestedAt?.toISOString() ?? null,
        patientName: r.patient.name,
        patientNumber: r.patient.patientNumber,
      })),
    };
  });
}

export async function retryRefund(ctx: TenantContext, orderUuid: string): Promise<{ refunded: boolean }> {
  requirePermission(ctx, ["refund.manage", "billing.manage", "appointment.update"]);
  if (!uuid.safeParse(orderUuid).success) throw new AuthError("NOT_FOUND");
  configOrUnavailable();
  return { refunded: await refundOwedOrder(orderUuid, "Retry", { staff: ctx }) };
}

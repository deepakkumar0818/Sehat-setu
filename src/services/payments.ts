import { delay } from "@/lib/async";
import type { PaymentMethod } from "@/types";

// A mock payment gateway abstraction. No real gateway is connected — this
// exists so the booking flow talks to a stable interface (createPaymentIntent
// -> confirmPayment -> getPaymentStatus) that a real provider (Razorpay,
// Stripe, etc.) could implement later without changing any UI component.
// A real implementation would live behind a server route; provider secret
// keys must never appear in frontend code.

export type PaymentIntentStatus = "requires_confirmation" | "processing" | "succeeded" | "failed";

export interface PaymentIntent {
  intentId: string;
  amount: number;
  status: PaymentIntentStatus;
  method?: PaymentMethod;
}

const intents = new Map<string, PaymentIntent>();
let counter = 1;

export async function createPaymentIntent(amount: number): Promise<PaymentIntent> {
  await delay(350);
  const intent: PaymentIntent = {
    intentId: `PI-DEMO-${String(counter++).padStart(6, "0")}`,
    amount,
    status: "requires_confirmation",
  };
  intents.set(intent.intentId, intent);
  return intent;
}

export async function confirmPayment(intentId: string, method: PaymentMethod): Promise<PaymentIntent> {
  const intent = intents.get(intentId);
  if (!intent) throw new Error("Payment session expired. Please start checkout again.");

  intents.set(intentId, { ...intent, status: "processing", method });
  await delay(1100); // simulated gateway round-trip

  const confirmed: PaymentIntent = { ...intent, status: "succeeded", method };
  intents.set(intentId, confirmed);
  return confirmed;
}

export async function getPaymentStatus(intentId: string): Promise<PaymentIntent | undefined> {
  await delay(150);
  return intents.get(intentId);
}

export async function refundPayment(intentId: string): Promise<PaymentIntent> {
  const intent = intents.get(intentId);
  if (!intent) throw new Error("Payment not found.");
  await delay(600);
  const refunded: PaymentIntent = { ...intent, status: "failed" };
  intents.set(intentId, refunded);
  return refunded;
}

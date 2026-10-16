// Opens Razorpay Checkout (https://checkout.razorpay.com/v1/checkout.js) for an
// order the SERVER created. Card/UPI details stay inside Razorpay's own frame;
// this app only receives the order id, payment id and signature, which the
// server verifies before anything is recorded.

import type { CheckoutOptions } from "@/lib/live-types";

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

type RazorpayCtor = new (options: Record<string, unknown>) => { open(): void; on(event: string, fn: (r: unknown) => void): void };

let loading: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Payment window unavailable"));
    };
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Resolves with Razorpay's success response, or null if the patient closed the window. Rejects on a failed payment. */
export async function openCheckout(options: CheckoutOptions): Promise<CheckoutSuccess | null> {
  const Razorpay = await loadCheckout();
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountPaise,
      currency: options.currency,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      theme: { color: "#2563eb" },
      handler: (response: CheckoutSuccess) => resolve(response),
      modal: { ondismiss: () => resolve(null), confirm_close: true },
    });
    rzp.on("payment.failed", () => reject(new Error("The payment didn't go through. No money was taken, or it will be refunded by your bank.")));
    rzp.open();
  });
}

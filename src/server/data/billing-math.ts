// Pure billing rules shared by the billing data module and its tests.
// All amounts are integer paise; nothing here touches the database.
//
// Calculation rules (documented in docs/security.md → Billing):
// - line amount   = quantity × unit price
// - subtotal      = Σ line amounts
// - tax           = round((subtotal − discount) × taxRate%)   (tax on the discounted value)
// - total         = subtotal − discount + tax
// - paid          = Σ SUCCEEDED payments (FAILED/PENDING/REFUNDED don't count)
// - balance       = max(0, total − paid)
// - status        = VOID stays VOID; paid ≥ total → PAID; paid > 0 → PARTIALLY_PAID; else PENDING
import type { InvoiceCategory, InvoiceStatus, Payment, PaymentMethod } from "@/types";

export type DbInvoiceStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "VOID";
export type DbPaymentStatus = "SUCCEEDED" | "PENDING" | "FAILED" | "REFUNDED";
export type DbPaymentMethod = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "ONLINE";
export type DbLineCategory = "CONSULTATION" | "MEDICINE" | "LAB_TEST" | "PROCEDURE" | "OTHER";

/** Upper bounds that keep every amount well inside a 32-bit integer column. */
export const BILLING_LIMITS = {
  maxLines: 50,
  maxQuantity: 1000,
  maxUnitPricePaise: 10_000_000, // ₹1,00,000 per unit
  maxTaxRatePercent: 28, // highest GST slab
  maxTotalPaise: 100_000_000, // ₹10,00,000 per invoice
} as const;

export class BillingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingRuleError";
  }
}

export interface LineInput {
  quantity: number;
  unitPricePaise: number;
}

export interface InvoiceTotals {
  lineAmountsPaise: number[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

const isWholeNonNegative = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function computeInvoiceTotals(lines: readonly LineInput[], discountPaise: number, taxRatePercent: number): InvoiceTotals {
  if (lines.length === 0) throw new BillingRuleError("Add at least one line item.");
  if (lines.length > BILLING_LIMITS.maxLines) throw new BillingRuleError(`An invoice can have at most ${BILLING_LIMITS.maxLines} line items.`);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > BILLING_LIMITS.maxQuantity) throw new BillingRuleError("Each quantity must be a whole number from 1 to 1000.");
    if (!isWholeNonNegative(l.unitPricePaise) || l.unitPricePaise > BILLING_LIMITS.maxUnitPricePaise) throw new BillingRuleError("Each unit price must be between ₹0 and ₹1,00,000.");
  }
  if (!isWholeNonNegative(discountPaise)) throw new BillingRuleError("The discount can't be negative.");
  if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > BILLING_LIMITS.maxTaxRatePercent) throw new BillingRuleError("Tax must be between 0% and 28%.");

  const lineAmountsPaise = lines.map((l) => l.quantity * l.unitPricePaise);
  const subtotalPaise = lineAmountsPaise.reduce((s, a) => s + a, 0);
  if (discountPaise > subtotalPaise) throw new BillingRuleError("The discount can't exceed the subtotal.");
  const taxPaise = Math.round(((subtotalPaise - discountPaise) * taxRatePercent) / 100);
  const totalPaise = subtotalPaise - discountPaise + taxPaise;
  if (totalPaise > BILLING_LIMITS.maxTotalPaise) throw new BillingRuleError("The invoice total is above the ₹10,00,000 limit.");
  return { lineAmountsPaise, subtotalPaise, discountPaise, taxPaise, totalPaise };
}

/** Amount actually received: only SUCCEEDED payments count. */
export function paidPaise(payments: readonly { amountPaise: number; status: DbPaymentStatus | string }[]): number {
  return payments.reduce((s, p) => (p.status === "SUCCEEDED" ? s + p.amountPaise : s), 0);
}

export function deriveInvoiceStatus(current: DbInvoiceStatus, totalPaise: number, paid: number): DbInvoiceStatus {
  if (current === "VOID") return "VOID";
  if (paid >= totalPaise) return "PAID";
  if (paid > 0) return "PARTIALLY_PAID";
  return "PENDING";
}

/** Validates a manual payment against what's still owed. */
export function assertPayable(status: DbInvoiceStatus, totalPaise: number, paid: number, amountPaise: number): void {
  if (status === "VOID") throw new BillingRuleError("This invoice is void and can't take payments.");
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new BillingRuleError("Enter an amount greater than zero.");
  const balance = Math.max(0, totalPaise - paid);
  if (balance === 0) throw new BillingRuleError("This invoice is already fully paid.");
  if (amountPaise > balance) throw new BillingRuleError(`The amount is more than the balance due (₹${(balance / 100).toFixed(2)}).`);
}

// --- UI mapping ---------------------------------------------------------------

const INVOICE_STATUS_TO_UI: Record<DbInvoiceStatus, InvoiceStatus> = { PENDING: "pending", PARTIALLY_PAID: "partial", PAID: "paid", VOID: "void" };
export const invoiceStatusToUi = (s: DbInvoiceStatus): InvoiceStatus => INVOICE_STATUS_TO_UI[s];

export function invoiceStatusFromUi(s: InvoiceStatus): DbInvoiceStatus[] {
  return (Object.entries(INVOICE_STATUS_TO_UI) as [DbInvoiceStatus, InvoiceStatus][]).filter(([, ui]) => ui === s).map(([db]) => db);
}

const PAYMENT_STATUS_TO_UI: Record<DbPaymentStatus, Payment["status"]> = { SUCCEEDED: "success", PENDING: "pending", FAILED: "failed", REFUNDED: "refunded" };
export const paymentStatusToUi = (s: DbPaymentStatus): Payment["status"] => PAYMENT_STATUS_TO_UI[s];

export const paymentMethodToUi = (m: DbPaymentMethod) => m.toLowerCase() as PaymentMethod;
export const paymentMethodFromUi = (m: PaymentMethod) => m.toUpperCase() as DbPaymentMethod;
export const lineCategoryToUi = (c: DbLineCategory) => c.toLowerCase() as InvoiceCategory;
export const lineCategoryFromUi = (c: InvoiceCategory) => c.toUpperCase() as DbLineCategory;

export const toRupees = (paise: number) => paise / 100;

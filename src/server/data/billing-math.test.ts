import { describe, expect, it } from "vitest";
import {
  assertPayable,
  BillingRuleError,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  invoiceStatusFromUi,
  invoiceStatusToUi,
  paidPaise,
  paymentMethodFromUi,
  paymentStatusToUi,
} from "./billing-math";

describe("invoice totals", () => {
  it("multiplies quantities, applies the discount, then taxes the discounted amount", () => {
    const t = computeInvoiceTotals([{ quantity: 2, unitPricePaise: 25_000 }, { quantity: 1, unitPricePaise: 50_000 }], 10_000, 18);
    expect(t).toEqual({ lineAmountsPaise: [50_000, 50_000], subtotalPaise: 100_000, discountPaise: 10_000, taxPaise: 16_200, totalPaise: 106_200 });
  });

  it("rounds tax to the nearest paisa", () => {
    expect(computeInvoiceTotals([{ quantity: 1, unitPricePaise: 333 }], 0, 5).taxPaise).toBe(17); // 16.65 → 17
  });

  it("allows a zero-value invoice (e.g. a free follow-up)", () => {
    expect(computeInvoiceTotals([{ quantity: 1, unitPricePaise: 0 }], 0, 0).totalPaise).toBe(0);
  });

  it.each([
    ["no lines", [], 0, 0],
    ["zero quantity", [{ quantity: 0, unitPricePaise: 100 }], 0, 0],
    ["fractional quantity", [{ quantity: 1.5, unitPricePaise: 100 }], 0, 0],
    ["negative price", [{ quantity: 1, unitPricePaise: -1 }], 0, 0],
    ["fractional paise", [{ quantity: 1, unitPricePaise: 10.5 }], 0, 0],
    ["price above the cap", [{ quantity: 1, unitPricePaise: 10_000_001 }], 0, 0],
    ["negative discount", [{ quantity: 1, unitPricePaise: 100 }], -1, 0],
    ["discount above subtotal", [{ quantity: 1, unitPricePaise: 100 }], 101, 0],
    ["tax above 28%", [{ quantity: 1, unitPricePaise: 100 }], 0, 29],
    ["negative tax", [{ quantity: 1, unitPricePaise: 100 }], 0, -5],
    ["NaN tax", [{ quantity: 1, unitPricePaise: 100 }], 0, Number.NaN],
    ["total above the cap", [{ quantity: 1000, unitPricePaise: 10_000_000 }], 0, 0],
  ])("rejects %s", (_label, lines, discount, tax) => {
    expect(() => computeInvoiceTotals(lines, discount, tax)).toThrow(BillingRuleError);
  });

  it("rejects more than 50 lines", () => {
    expect(() => computeInvoiceTotals(Array.from({ length: 51 }, () => ({ quantity: 1, unitPricePaise: 1 })), 0, 0)).toThrow(/at most 50/);
  });
});

describe("payments and status", () => {
  const payments = [
    { amountPaise: 30_000, status: "SUCCEEDED" },
    { amountPaise: 99_999, status: "FAILED" },
    { amountPaise: 10_000, status: "REFUNDED" },
    { amountPaise: 5_000, status: "PENDING" },
    { amountPaise: 20_000, status: "SUCCEEDED" },
  ];

  it("counts only SUCCEEDED payments as paid", () => {
    expect(paidPaise(payments)).toBe(50_000);
  });

  it("derives the invoice status from what was paid; VOID is final", () => {
    expect(deriveInvoiceStatus("PENDING", 100_000, 0)).toBe("PENDING");
    expect(deriveInvoiceStatus("PENDING", 100_000, 1)).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus("PARTIALLY_PAID", 100_000, 100_000)).toBe("PAID");
    expect(deriveInvoiceStatus("PAID", 100_000, 40_000)).toBe("PARTIALLY_PAID"); // after a refund
    expect(deriveInvoiceStatus("PAID", 100_000, 0)).toBe("PENDING");
    expect(deriveInvoiceStatus("PENDING", 0, 0)).toBe("PAID");
    expect(deriveInvoiceStatus("VOID", 100_000, 100_000)).toBe("VOID");
  });

  it("accepts a payment up to the balance and never more", () => {
    expect(() => assertPayable("PARTIALLY_PAID", 100_000, 40_000, 60_000)).not.toThrow();
    expect(() => assertPayable("PARTIALLY_PAID", 100_000, 40_000, 60_001)).toThrow(/more than the balance/);
    expect(() => assertPayable("PAID", 100_000, 100_000, 1)).toThrow(/already fully paid/);
    expect(() => assertPayable("VOID", 100_000, 0, 1)).toThrow(/void/);
    for (const bad of [0, -100, 0.5, Number.NaN]) expect(() => assertPayable("PENDING", 100_000, 0, bad)).toThrow(/greater than zero/);
  });
});

describe("UI mapping", () => {
  it("round-trips invoice statuses", () => {
    expect(invoiceStatusToUi("PARTIALLY_PAID")).toBe("partial");
    expect(invoiceStatusToUi("VOID")).toBe("void");
    expect(invoiceStatusFromUi("partial")).toEqual(["PARTIALLY_PAID"]);
    expect(invoiceStatusFromUi("refunded")).toEqual([]); // demo-only status: matches nothing in the database
  });

  it("maps payment statuses and methods", () => {
    expect(paymentStatusToUi("SUCCEEDED")).toBe("success");
    expect(paymentMethodFromUi("bank_transfer")).toBe("BANK_TRANSFER");
  });
});

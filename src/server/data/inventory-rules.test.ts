import { describe, expect, it } from "vitest";
import { batchKey, batchStatus, daysUntil, isExpired, normalizeBatch, stockPosition } from "./inventory-rules";

const TODAY = "2026-10-13";

describe("IST expiry boundary", () => {
  it("treats a batch as usable through its expiry date and expired from the next day", () => {
    expect(isExpired("2026-10-13", TODAY)).toBe(false);
    expect(isExpired("2026-10-12", TODAY)).toBe(true);
    expect(daysUntil("2026-11-12", TODAY)).toBe(30);
    expect(daysUntil("2026-10-12", TODAY)).toBe(-1);
  });
});

describe("batch numbers", () => {
  it("are trimmed for storage and compared case-insensitively", () => {
    expect(normalizeBatch("  AB-12 ")).toBe("AB-12");
    expect(batchKey(" ab-12")).toBe(batchKey("AB-12 "));
  });
});

describe("stock status priority: expired → out of stock → expiring soon → low → in stock", () => {
  const b = (expiryDate: string, quantityOnHand: number) => ({ expiryDate, quantityOnHand });

  it("flags expired stock on hand first, and doesn't count it as usable", () => {
    expect(stockPosition([b("2026-10-12", 5), b("2027-06-01", 100)], 10, TODAY)).toEqual({ status: "expired", usableQuantity: 100, expiredQuantity: 5, nearestExpiry: "2027-06-01" });
  });

  it("is out of stock when nothing usable remains (or there are no batches)", () => {
    expect(stockPosition([], 10, TODAY).status).toBe("out_of_stock");
    expect(stockPosition([b("2027-01-01", 0)], 0, TODAY).status).toBe("out_of_stock");
    expect(stockPosition([b("2026-10-12", 0)], 0, TODAY).status).toBe("out_of_stock"); // empty expired batch needs no write-off
  });

  it("is expiring soon within 30 days, ahead of low stock", () => {
    expect(stockPosition([b("2026-11-12", 2)], 10, TODAY).status).toBe("expiring_soon");
    expect(stockPosition([b("2026-11-13", 2)], 10, TODAY).status).toBe("low_stock");
  });

  it("compares usable quantity across batches with the branch reorder level", () => {
    expect(stockPosition([b("2027-01-01", 4), b("2027-02-01", 6)], 10, TODAY).status).toBe("low_stock");
    expect(stockPosition([b("2027-01-01", 4), b("2027-02-01", 7)], 10, TODAY).status).toBe("in_stock");
    expect(stockPosition([b("2027-01-01", 1)], 0, TODAY).status).toBe("in_stock"); // no reorder level = no low-stock alert
  });
});

describe("batch status", () => {
  it("labels individual batches", () => {
    expect(batchStatus({ expiryDate: "2026-10-12", quantityOnHand: 0 }, TODAY)).toBe("expired");
    expect(batchStatus({ expiryDate: "2027-10-12", quantityOnHand: 0 }, TODAY)).toBe("empty");
    expect(batchStatus({ expiryDate: "2026-10-20", quantityOnHand: 3 }, TODAY)).toBe("expiring_soon");
    expect(batchStatus({ expiryDate: "2027-10-20", quantityOnHand: 3 }, TODAY)).toBe("available");
  });
});

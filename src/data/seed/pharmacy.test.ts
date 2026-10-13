import { describe, expect, it } from "vitest";
import { getMedicineStatus } from "@/data/seed/pharmacy";
import type { Medicine } from "@/types";

const NOW = new Date(2026, 8, 5);

function medicine(overrides: Partial<Medicine>): Medicine {
  return {
    id: "MD-001",
    name: "Paracetamol",
    category: "Analgesic",
    batchNumber: "B2026001",
    stock: 100,
    unit: "strips",
    reorderLevel: 20,
    expiryDate: "2027-01-01",
    supplier: "MedPlus Distributors",
    pricePerUnit: 20,
    ...overrides,
  };
}

describe("getMedicineStatus", () => {
  it("returns expired when the expiry date has passed", () => {
    expect(getMedicineStatus(medicine({ expiryDate: "2026-01-01" }), NOW)).toBe("expired");
  });

  it("returns out_of_stock when stock is zero and not expired", () => {
    expect(getMedicineStatus(medicine({ stock: 0 }), NOW)).toBe("out_of_stock");
  });

  it("returns expiring_soon when expiry is within 30 days", () => {
    expect(getMedicineStatus(medicine({ expiryDate: "2026-09-20", stock: 100 }), NOW)).toBe("expiring_soon");
  });

  it("returns low_stock when stock is at or below the reorder level", () => {
    expect(getMedicineStatus(medicine({ stock: 15, reorderLevel: 20 }), NOW)).toBe("low_stock");
  });

  it("returns in_stock when stock is healthy and expiry is far away", () => {
    expect(getMedicineStatus(medicine({ stock: 100, reorderLevel: 20, expiryDate: "2027-06-01" }), NOW)).toBe("in_stock");
  });
});

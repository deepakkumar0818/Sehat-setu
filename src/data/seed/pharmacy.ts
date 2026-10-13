import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type { Medicine, StockMovement } from "@/types";
import { MEDICINES, SUPPLIERS } from "@/data/pools";

function randomBatch(rng: Rng): string {
  return `B${rng.int(2024, 2026)}${String(rng.int(1, 999)).padStart(3, "0")}`;
}

export function generateMedicines(rng: Rng, now: Date): { medicines: Medicine[]; stockMovements: StockMovement[] } {
  const medicines: Medicine[] = [];
  const stockMovements: StockMovement[] = [];
  let counter = 1;
  let movementCounter = 1;

  for (const med of MEDICINES) {
    const batchCount = rng.weighted<number>([
      [1, 40],
      [2, 40],
      [3, 20],
    ]);
    for (let b = 0; b < batchCount; b++) {
      const reorderLevel = rng.int(20, 60);
      const stockKind = rng.weighted<"healthy" | "low" | "out" | "expiringHealthy">([
        ["healthy", 68],
        ["low", 15],
        ["out", 5],
        ["expiringHealthy", 12],
      ]);
      const stock = stockKind === "out" ? 0 : stockKind === "low" ? rng.int(1, reorderLevel - 1) : rng.int(reorderLevel + 20, reorderLevel + 300);
      const expiryDate =
        stockKind === "expiringHealthy" || rng.bool(0.1)
          ? rng.dateOffset(now, -10, 25)
          : rng.dateOffset(now, 60, 720);

      const medicine: Medicine = {
        id: padId("MD", counter++, 3),
        name: med.name,
        category: med.category,
        batchNumber: randomBatch(rng),
        stock,
        unit: med.name.toLowerCase().includes("syrup") || med.name.toLowerCase().includes("gel") ? "bottles" : med.name.toLowerCase().includes("inhaler") ? "units" : "strips",
        reorderLevel,
        expiryDate: expiryDate.toISOString().slice(0, 10),
        supplier: rng.pick(SUPPLIERS),
        pricePerUnit: rng.int(10, 400),
      };
      medicines.push(medicine);

      stockMovements.push({
        id: padId("SM", movementCounter++, 5),
        medicineId: medicine.id,
        type: "purchase",
        quantity: stock + rng.int(20, 80),
        date: rng.dateOffset(now, -90, -20).toISOString().slice(0, 10),
        reference: `PO-${rng.int(1000, 9999)}`,
      });
      if (stock > 0) {
        stockMovements.push({
          id: padId("SM", movementCounter++, 5),
          medicineId: medicine.id,
          type: "sale",
          quantity: rng.int(5, 40),
          date: rng.dateOffset(now, -20, -1).toISOString().slice(0, 10),
        });
      }
    }
  }

  return { medicines, stockMovements };
}

export function getMedicineStatus(medicine: Medicine, now: Date): "in_stock" | "low_stock" | "out_of_stock" | "expiring_soon" | "expired" {
  const expiry = new Date(medicine.expiryDate);
  const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
  if (daysToExpiry < 0) return "expired";
  if (medicine.stock === 0) return "out_of_stock";
  if (daysToExpiry <= 30) return "expiring_soon";
  if (medicine.stock <= medicine.reorderLevel) return "low_stock";
  return "in_stock";
}

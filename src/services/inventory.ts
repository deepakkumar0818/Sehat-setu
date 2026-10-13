import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { DEMO_NOW } from "@/lib/demo-clock";
import { getDb, mutateDb } from "@/store/data-store";
import { getMedicineStatus } from "@/data/seed/pharmacy";
import type { Medicine, MedicineStatus, StockMovement } from "@/types";

export interface MedicineWithStatus extends Medicine {
  status: MedicineStatus;
}

function enrich(m: Medicine): MedicineWithStatus {
  return { ...m, status: getMedicineStatus(m, DEMO_NOW) };
}

// --- Clinic-database inventory (live mode) -------------------------------------
// One overview row per medicine per branch; stock lives in batches and only
// changes through recorded movements.

export interface StockRow {
  medicineId: string;
  branchId: string;
  branchName: string;
  name: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  usableQuantity: number;
  expiredQuantity: number;
  batchCount: number;
  nearestExpiry?: string;
  reorderLevel: number;
  status: MedicineStatus;
}

export interface ListStockParams {
  search?: string;
  status?: MedicineStatus | "all";
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export interface StockBatch {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
  unitCostPaise?: number;
  supplierName?: string;
  status: "expired" | "expiring_soon" | "empty" | "available";
  receivedAt: string;
}

export interface StockMovementEntry {
  id: string;
  inventoryItemId: string;
  batchNumber: string;
  type: "receipt" | "adjustment" | "reversal";
  quantityDelta: number;
  quantityAfter: number;
  reason?: string;
  reference?: string;
  actorName: string;
  occurredAt: string;
  reversesMovementId?: string;
  reversedById?: string;
}

export interface StockDetail extends StockRow {
  batches: StockBatch[];
  movements: StockMovementEntry[];
  /** UI hint; the server and database re-check every change. */
  canManage: boolean;
}

export interface LiveInventorySummary {
  total: number;
  lowStock: number;
  outOfStock: number;
  expiringSoon: number;
  expired: number;
  canManage: boolean;
}

export interface ReceiveStockInput {
  branchId?: string;
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitCostPaise?: number;
  supplierName?: string;
  reference?: string;
}

export interface ListMedicinesParams {
  search?: string;
  status?: MedicineStatus | "all";
  category?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listMedicines(params: ListMedicinesParams = {}): Promise<PagedResult<MedicineWithStatus>> {
  await delay();
  const { search = "", status = "all", category = "all", page = 1, pageSize = 12 } = params;
  const items = getDb()
    .medicines.map(enrich)
    .filter((m) => {
      if (status !== "all" && m.status !== status) return false;
      if (category !== "all" && m.category !== category) return false;
      return matchesSearch([m.name, m.batchNumber, m.supplier], search);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return paginate(items, page, pageSize);
}

export async function getMedicine(id: string): Promise<MedicineWithStatus | undefined> {
  await delay(250);
  const found = getDb().medicines.find((m) => m.id === id);
  return found ? enrich(found) : undefined;
}

export async function getInventorySummary() {
  await delay(300);
  const items = getDb().medicines.map(enrich);
  return {
    total: items.length,
    lowStock: items.filter((m) => m.status === "low_stock").length,
    outOfStock: items.filter((m) => m.status === "out_of_stock").length,
    expiringSoon: items.filter((m) => m.status === "expiring_soon").length,
    expired: items.filter((m) => m.status === "expired").length,
  };
}

export async function adjustStock(id: string, delta: number, reference?: string): Promise<Medicine> {
  await delay(350);
  let updated: Medicine | undefined;
  mutateDb((d) => {
    const movement: StockMovement = {
      id: padId("SM", 100000 + d.stockMovements.length + 1, 5),
      medicineId: id,
      type: delta > 0 ? "purchase" : "adjustment",
      quantity: Math.abs(delta),
      date: new Date().toISOString().slice(0, 10),
      reference,
    };
    return {
      ...d,
      medicines: d.medicines.map((m) => {
        if (m.id !== id) return m;
        updated = { ...m, stock: Math.max(0, m.stock + delta) };
        return updated;
      }),
      stockMovements: [movement, ...d.stockMovements],
    };
  });
  if (!updated) throw new Error("Medicine not found");
  return updated;
}

export interface CreateMedicineInput {
  name: string;
  category: string;
  batchNumber: string;
  stock: number;
  unit: string;
  reorderLevel: number;
  expiryDate: string;
  supplier: string;
  pricePerUnit: number;
}

export async function createMedicine(input: CreateMedicineInput): Promise<Medicine> {
  await delay(400);
  const db = getDb();
  const medicine: Medicine = { id: padId("MD", db.medicines.length + 1, 3), ...input };
  mutateDb((d) => ({ ...d, medicines: [medicine, ...d.medicines] }));
  return medicine;
}

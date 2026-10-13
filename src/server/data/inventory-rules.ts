// Pure stock rules shared by the inventory data module and its tests.
// Dates are IST calendar days (yyyy-MM-dd). A batch is usable through its
// expiry date and expired from the start of the next IST day.
import type { MedicineStatus } from "@/types";

export const EXPIRING_SOON_DAYS = 30;

export const INVENTORY_LIMITS = {
  maxQuantity: 100_000,
  maxUnitCostPaise: 10_000_000, // ₹1,00,000
  batchMaxLength: 64,
  supplierMaxLength: 120,
  referenceMaxLength: 100,
  reasonMinLength: 3,
  reasonMaxLength: 300,
  maxReorderLevel: 1_000_000,
} as const;

/** Batch numbers are stored trimmed and compared case-insensitively (the database index does the same). */
export const normalizeBatch = (batch: string) => batch.trim();
export const batchKey = (batch: string) => batch.trim().toLowerCase();

export const isExpired = (expiryDate: string, todayIst: string) => expiryDate < todayIst;

/** Whole days from today (IST) to the expiry date; negative once expired. */
export function daysUntil(expiryDate: string, todayIst: string): number {
  return Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${todayIst}T00:00:00Z`)) / 86_400_000);
}

export interface BatchLike {
  expiryDate: string;
  quantityOnHand: number;
}

export interface StockPosition {
  status: MedicineStatus;
  /** On hand in unexpired batches: what can actually be used. */
  usableQuantity: number;
  /** On hand in expired batches: awaiting write-off. */
  expiredQuantity: number;
  /** Earliest expiry among unexpired batches that still hold stock. */
  nearestExpiry?: string;
}

/**
 * Status for one medicine at one branch, by priority:
 * expired stock on hand → out of stock → expiring within 30 days → low stock → in stock.
 */
export function stockPosition(batches: readonly BatchLike[], reorderLevel: number, todayIst: string): StockPosition {
  let usableQuantity = 0;
  let expiredQuantity = 0;
  let nearestExpiry: string | undefined;
  for (const b of batches) {
    if (b.quantityOnHand <= 0) continue;
    if (isExpired(b.expiryDate, todayIst)) {
      expiredQuantity += b.quantityOnHand;
    } else {
      usableQuantity += b.quantityOnHand;
      if (!nearestExpiry || b.expiryDate < nearestExpiry) nearestExpiry = b.expiryDate;
    }
  }
  let status: MedicineStatus;
  if (expiredQuantity > 0) status = "expired";
  else if (usableQuantity === 0) status = "out_of_stock";
  else if (nearestExpiry && daysUntil(nearestExpiry, todayIst) <= EXPIRING_SOON_DAYS) status = "expiring_soon";
  else if (reorderLevel > 0 && usableQuantity <= reorderLevel) status = "low_stock";
  else status = "in_stock";
  return { status, usableQuantity, expiredQuantity, nearestExpiry };
}

export type BatchStatus = "expired" | "expiring_soon" | "empty" | "available";

export function batchStatus(b: BatchLike, todayIst: string): BatchStatus {
  if (isExpired(b.expiryDate, todayIst)) return "expired";
  if (b.quantityOnHand <= 0) return "empty";
  if (daysUntil(b.expiryDate, todayIst) <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "available";
}

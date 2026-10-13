import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate, optionalContextFor, present } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { adjustStock, getInventorySummary, getStockDetail, listStock, receiveStock, reverseMovement, setReorderLevel } from "./inventory";

// Inventory against the live database, as real (fictional) fixture users.
// Every write runs in a transaction that is rolled back, and table counts
// (including the append-only stock ledger and audit trail) are compared
// afterwards, so no stock, movement or audit rows are left behind.
// Test batch numbers start with "TEST-".

let admin: Client;
let adminA: TenantContext; // Aarogya administrator: pharmacy.manage, clinic-wide
let adminB: TenantContext; // Nirmaya administrator
let managerWakad: TenantContext; // Aarogya clinic manager, Wakad: pharmacy.inventory.view only
let receptionWakad: TenantContext; // no inventory permission
let nurseKothrud: TenantContext | undefined; // no inventory permission
let doctor1: TenantContext; // no inventory permission
let medA: string;
let medB: string;
let counts: Record<string, number>;

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  items: await n(`SELECT count(*) n FROM inventory_items`),
  movements: await n(`SELECT count(*) n FROM stock_movements`),
  levels: await n(`SELECT count(*) n FROM inventory_reorder_levels`),
  medicines: await n(`SELECT count(*) n FROM medicines`),
  rolePermissions: await n(`SELECT count(*) n FROM role_permissions`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
/** The database's own refusal message (so a test can't pass for the wrong reason). */
const dbRefusal = (p: Promise<unknown>) => p.then(() => "OK", (e: Error) => e.message);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-02", "ST-04", "DR-01"]) ctxs.push(await contextFor(admin, k)); // one pg client: sequential
  [adminA, adminB, managerWakad, receptionWakad, doctor1] = ctxs;
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  [medA, medB] = (await admin.query(`SELECT id FROM medicines WHERE "isActive" ORDER BY name LIMIT 2`)).rows.map((r) => r.id as string);
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

/** Receives a fresh test batch at Kothrud as administrator A (inside the caller's rollback). */
async function receiveTestBatch(tx: TenantTx, as: (c: TenantContext) => Promise<void>, opts: { batch?: string; qty?: number; expiry?: string; branchId?: string; medicineId?: string } = {}) {
  await as(adminA);
  const detail = await receiveStock(
    adminA,
    { branchId: opts.branchId ?? FIX.kothrud, medicineId: opts.medicineId ?? medA, batchNumber: opts.batch ?? "TEST-B1", expiryDate: opts.expiry ?? istDate(200), quantity: opts.qty ?? 10, supplierName: "Test Supplier", reference: "TEST-GRN-1", unitCostPaise: 250 },
    tx
  );
  const batch = detail.batches.find((b) => b.batchNumber.toLowerCase() === (opts.batch ?? "TEST-B1").toLowerCase())!;
  return { detail, batch };
}

describe("effective permissions", () => {
  it("lets administrators manage, clinic managers only view, and nobody else in", async () => {
    expect((await getInventorySummary(adminA, undefined)).canManage).toBe(true);
    expect((await getInventorySummary(managerWakad, undefined)).canManage).toBe(false);
    expect(managerWakad.permissions.has("pharmacy.inventory.view")).toBe(true);
    expect(managerWakad.permissions.has("pharmacy.inventory.manage") || managerWakad.permissions.has("pharmacy.manage")).toBe(false);
    for (const ctx of present(receptionWakad, nurseKothrud, doctor1)) {
      expect(await code(listStock(ctx, {}))).toBe("FORBIDDEN");
      expect(await code(getInventorySummary(ctx, undefined))).toBe("FORBIDDEN");
    }
  });
});

describe("receiving stock", () => {
  it("creates the batch, records the receipt, and reconciles quantity with the ledger", async () => {
    await inRollback(async ({ tx, as }) => {
      const { detail, batch } = await receiveTestBatch(tx, as, { qty: 10 });
      expect(batch).toMatchObject({ quantityOnHand: 10, supplierName: "Test Supplier", unitCostPaise: 250, status: "available" });
      expect(detail).toMatchObject({ usableQuantity: 10, status: "in_stock", canManage: true });
      expect(detail.movements[0]).toMatchObject({ type: "receipt", quantityDelta: 10, quantityAfter: 10, reference: "TEST-GRN-1" });
      // A second receipt into the same batch (different case/spacing) adds to it — no duplicate batch.
      const again = await receiveStock(adminA, { branchId: FIX.kothrud, medicineId: medA, batchNumber: "  test-b1 ", expiryDate: istDate(200), quantity: 5 }, tx);
      expect(again.batches).toHaveLength(1);
      expect(again.batches[0].quantityOnHand).toBe(15);
      const ledger = (await tx.stockMovement.findMany({ where: { inventoryItemId: batch.id } })).reduce((s, m) => s + m.quantityDelta, 0);
      expect(ledger).toBe(15); // quantity on hand == sum of movements
      // Server-set fields: actor and time come from the database, not the caller.
      const m = await tx.stockMovement.findFirstOrThrow({ where: { inventoryItemId: batch.id, type: "RECEIPT" }, select: { actorUserId: true, clinicId: true } });
      expect(m).toEqual({ actorUserId: adminA.userId, clinicId: FIX.clinicA });
      // Persists and appears in the overview/summary.
      expect((await listStock(adminA, { search: "TEST-B1" }, tx)).items.some((r) => r.medicineId === medA && r.branchId === FIX.kothrud)).toBe(true);
    });
  });

  it("rejects bad batches, expiries and quantities", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const base = { branchId: FIX.kothrud, medicineId: medA, batchNumber: "TEST-B2", expiryDate: istDate(100), quantity: 5 };
      expect(await code(receiveStock(adminA, { ...base, batchNumber: "   " }, tx))).toBe("ZodError");
      expect(await code(receiveStock(adminA, { ...base, expiryDate: undefined }, tx))).toBe("ZodError");
      expect(await code(receiveStock(adminA, { ...base, expiryDate: "2026-02-31" }, tx))).toBe("ZodError");
      expect(await code(receiveStock(adminA, { ...base, expiryDate: istDate(-1) }, tx))).toBe("INVALID_INPUT"); // expired yesterday (IST)
      expect(await code(receiveStock(adminA, { ...base, quantity: 0 }, tx))).toBe("ZodError");
      expect(await code(receiveStock(adminA, { ...base, quantity: -3 }, tx))).toBe("ZodError");
      expect(await code(receiveStock(adminA, { ...base, medicineId: "00000000-0000-4000-8000-000000000000" }, tx))).toBe("INVALID_INPUT");
      expect(await code(receiveStock(adminA, { ...base, quantityOnHand: 999 }, tx))).toBe("ZodError"); // can't set quantity directly
      // Today's expiry is still usable (expired from the start of the next IST day).
      expect((await receiveStock(adminA, { ...base, expiryDate: istDate(0) }, tx)).batches[0].status).toBe("expiring_soon");
      // Same batch, different expiry → refused (not silently merged or duplicated).
      expect(await code(receiveStock(adminA, { ...base, expiryDate: istDate(5) }, tx))).toBe("INVALID_INPUT");
    });
  });

  it("serialises concurrent receipts of the same new batch (no duplicate batch rows)", async () => {
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let firstIn!: () => void;
    const firstHasLock = new Promise<void>((r) => (firstIn = r));
    let firstDone = 0;
    const first = inRollback(async ({ tx, as }) => {
      await receiveTestBatch(tx, as, { batch: "TEST-CONC", qty: 3 });
      firstIn();
      await holding;
      firstDone = Date.now();
    });
    await firstHasLock;
    const second = inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { batch: "TEST-CONC", qty: 4 }); // waits for the first to finish
      expect(firstDone).toBeGreaterThan(0);
      expect(batch.quantityOnHand).toBe(4);
    });
    setTimeout(release, 1500);
    await Promise.all([first, second]);
  });
});

describe("adjustments and reversals", () => {
  it("requires a reason, prevents negative stock, and allows removals down to zero", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { qty: 10 });
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: -2 }, tx))).toBe("ZodError");
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: -2, reason: "x" }, tx))).toBe("ZodError");
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: 0, reason: "Count check" }, tx))).toBe("ZodError");
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: -11, reason: "Damaged in storage" }, tx))).toBe("INSUFFICIENT_STOCK");
      const after = await adjustStock(adminA, batch.id, { quantityDelta: -10, reason: "Damaged in storage" }, tx);
      expect(after.batches[0].quantityOnHand).toBe(0);
      expect(after.status).toBe("out_of_stock");
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: -1, reason: "Damaged in storage" }, tx))).toBe("INSUFFICIENT_STOCK");
      const plus = await adjustStock(adminA, batch.id, { quantityDelta: 4, reason: "Count correction" }, tx);
      expect(plus.batches[0].quantityOnHand).toBe(4); // positive adjustment on an unexpired batch
    });
  });

  it("reverses a movement exactly once with the exact opposite quantity; reversals can't be reversed", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { qty: 10 });
      const adjusted = await adjustStock(adminA, batch.id, { quantityDelta: -3, reason: "Damaged in storage" }, tx);
      const adj = adjusted.movements.find((m) => m.type === "adjustment")!;
      const reversed = await reverseMovement(adminA, adj.id, { reason: "Entered by mistake" }, tx);
      expect(reversed.batches[0].quantityOnHand).toBe(10);
      const rev = reversed.movements.find((m) => m.type === "reversal")!;
      expect(rev).toMatchObject({ quantityDelta: 3, reversesMovementId: adj.id });
      expect(reversed.movements.find((m) => m.id === adj.id)?.reversedById).toBe(rev.id);
      expect(await code(reverseMovement(adminA, adj.id, {}, tx))).toBe("INVALID_TRANSITION");
      expect(await code(reverseMovement(adminA, rev.id, {}, tx))).toBe("INVALID_TRANSITION");
      // Reversing the receipt now would need all 10 back out: allowed exactly, since 10 are on hand.
      const receipt = reversed.movements.find((m) => m.type === "receipt")!;
      expect((await reverseMovement(adminA, receipt.id, {}, tx)).batches[0].quantityOnHand).toBe(0);
    });
  });

  it("refuses reversing a receipt that would take stock below zero", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch, detail } = await receiveTestBatch(tx, as, { qty: 5 });
      await adjustStock(adminA, batch.id, { quantityDelta: -4, reason: "Damaged in storage" }, tx);
      expect(await code(reverseMovement(adminA, detail.movements[0].id, {}, tx))).toBe("INSUFFICIENT_STOCK");
    });
  });
});

describe("expired batches", () => {
  it("can be written off but never added to", async () => {
    await inRollback(async ({ tx, as }) => {
      // Receive today with an expiry 2 days out, then view and change it "3 days later".
      const { batch } = await receiveTestBatch(tx, as, { qty: 6, expiry: istDate(2) });
      const later = new Date(Date.now() + 3 * 864e5);
      const detail = await getStockDetail(adminA, FIX.kothrud, medA, tx, later);
      expect(detail.batches[0].status).toBe("expired");
      expect(detail).toMatchObject({ status: "expired", usableQuantity: 0, expiredQuantity: 6 });
      expect(await code(adjustStock(adminA, batch.id, { quantityDelta: 2, reason: "Count correction" }, tx, later))).toBe("INVALID_INPUT");
      expect(await code(receiveStock(adminA, { branchId: FIX.kothrud, medicineId: medA, batchNumber: "TEST-B1", expiryDate: istDate(2), quantity: 1 }, tx, later))).toBe("INVALID_INPUT");
      const writtenOff = await adjustStock(adminA, batch.id, { quantityDelta: -6, reason: "Expired — written off" }, tx, later);
      expect(writtenOff.batches[0].quantityOnHand).toBe(0);
    });
  });
});

describe("reorder levels and status", () => {
  it("flags low stock per medicine per branch", async () => {
    await inRollback(async ({ tx, as }) => {
      await receiveTestBatch(tx, as, { qty: 8 });
      expect((await setReorderLevel(adminA, FIX.kothrud, medA, { reorderLevel: 10 }, tx)).status).toBe("low_stock");
      expect((await setReorderLevel(adminA, FIX.kothrud, medA, { reorderLevel: 5 }, tx)).status).toBe("in_stock");
      // A reorder level with no stock shows the medicine as out of stock at that branch.
      expect((await setReorderLevel(adminA, FIX.kothrud, medB, { reorderLevel: 3 }, tx)).status).toBe("out_of_stock");
      const summary = await getInventorySummary(adminA, FIX.kothrud, tx);
      expect(summary.outOfStock).toBeGreaterThanOrEqual(1);
      expect(await code(setReorderLevel(adminA, FIX.kothrud, medA, { reorderLevel: -1 }, tx))).toBe("ZodError");
    });
  });
});

describe("isolation and authorization", () => {
  it("keeps clinics and branches apart, and clinic managers read-only", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { qty: 10, branchId: FIX.kothrud });
      await receiveTestBatch(tx, as, { qty: 7, branchId: FIX.wakad, batch: "TEST-W1" });
      // Wakad manager sees Wakad stock only, and can't open Kothrud's.
      await as(managerWakad);
      const view = await listStock(managerWakad, { pageSize: 100 }, tx);
      expect(view.items.length).toBeGreaterThan(0);
      expect(view.items.every((r) => r.branchId === FIX.wakad)).toBe(true);
      expect(await code(getStockDetail(managerWakad, FIX.kothrud, medA, tx))).toBe("NOT_FOUND");
      expect(await code(listStock(managerWakad, { branchId: FIX.kothrud }, tx))).toBe("BRANCH_FORBIDDEN");
      const wakadDetail = await getStockDetail(managerWakad, FIX.wakad, medA, tx);
      expect(wakadDetail).toMatchObject({ canManage: false, usableQuantity: 7 });
      // ...and can't change anything (app layer).
      expect(await code(adjustStock(managerWakad, wakadDetail.batches[0].id, { quantityDelta: -1, reason: "Damaged in storage" }, tx))).toBe("FORBIDDEN");
      expect(await code(receiveStock(managerWakad, { branchId: FIX.wakad, medicineId: medA, batchNumber: "TEST-X", expiryDate: istDate(90), quantity: 1 }, tx))).toBe("FORBIDDEN");
      expect(await code(setReorderLevel(managerWakad, FIX.wakad, medA, { reorderLevel: 1 }, tx))).toBe("FORBIDDEN");
      // Other clinic: nothing visible, nothing reachable.
      await as(adminB);
      expect((await listStock(adminB, { search: "TEST-" }, tx)).total).toBe(0);
      expect(await code(adjustStock(adminB, batch.id, { quantityDelta: -1, reason: "Damaged in storage" }, tx))).toBe("NOT_FOUND");
      expect(await tx.inventoryItem.count({ where: { id: batch.id } })).toBe(0); // RLS
    });
  });
});

describe("database-level guarantees (app checks bypassed)", () => {
  it("doesn't let the runtime role write quantity directly", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as);
      expect(await dbRefusal(tx.$executeRaw`UPDATE inventory_items SET "quantityOnHand" = 999 WHERE id = ${batch.id}::uuid`)).toMatch(/permission denied/);
    });
  });

  it("refuses a movement that would make stock negative", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { qty: 2 });
      expect(
        await dbRefusal(tx.$executeRaw`INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", reason)
          VALUES (${FIX.clinicA}::uuid, ${FIX.kothrud}::uuid, ${batch.id}::uuid, 'ADJUSTMENT', -3, ${adminA.userId}::uuid, 'Direct attempt')`)
      ).toMatch(/insufficient stock/);
    });
  });

  it("refuses movements from a view-only clinic manager", async () => {
    await inRollback(async ({ tx, as }) => {
      const { batch } = await receiveTestBatch(tx, as, { branchId: FIX.wakad, batch: "TEST-W2" });
      await as(managerWakad);
      expect(
        await dbRefusal(tx.$executeRaw`INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", reason)
          VALUES (${FIX.clinicA}::uuid, ${FIX.wakad}::uuid, ${batch.id}::uuid, 'ADJUSTMENT', -1, ${managerWakad.userId}::uuid, 'Direct attempt')`)
      ).toMatch(/not permitted/);
    });
  });

  it("keeps the movement ledger append-only", async () => {
    await inRollback(async ({ tx, as }) => {
      const { detail } = await receiveTestBatch(tx, as);
      expect(await dbRefusal(tx.$executeRaw`UPDATE stock_movements SET "quantityDelta" = 999 WHERE id = ${detail.movements[0].id}::uuid`)).toMatch(/permission denied|append-only/);
    });
    await inRollback(async ({ tx, as }) => {
      const { detail } = await receiveTestBatch(tx, as);
      expect(await dbRefusal(tx.$executeRaw`DELETE FROM stock_movements WHERE id = ${detail.movements[0].id}::uuid`)).toMatch(/permission denied|append-only/);
    });
  });

  it("refuses receipts into an expired batch at the database too", async () => {
    // The batch row is inserted directly (quantity 0) with a past expiry, then a receipt is attempted.
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const [{ id }] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "updatedAt")
        VALUES (${FIX.clinicA}::uuid, ${FIX.kothrud}::uuid, ${medA}::uuid, 'TEST-OLD', ${istDate(-3)}::date, now()) RETURNING id`;
      expect(
        await dbRefusal(tx.$executeRaw`INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId")
          VALUES (${FIX.clinicA}::uuid, ${FIX.kothrud}::uuid, ${id}::uuid, 'RECEIPT', 5, ${adminA.userId}::uuid)`)
      ).toMatch(/batch is expired/);
    });
  });

  it("rejects a duplicate batch row at the database (case/spacing-insensitive)", async () => {
    await inRollback(async ({ tx, as }) => {
      await receiveTestBatch(tx, as, { batch: "TEST-DUP" });
      expect(
        await dbRefusal(tx.$executeRaw`INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "updatedAt")
          VALUES (${FIX.clinicA}::uuid, ${FIX.kothrud}::uuid, ${medA}::uuid, ' test-dup ', ${istDate(200)}::date, now())`)
      ).toMatch(/inventory_items_batch_key|duplicate key/);
    });
  });
});

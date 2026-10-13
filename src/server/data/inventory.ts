import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { assertBranchAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { istTodayKey } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { ListStockParams, LiveInventorySummary, ReceiveStockInput, StockDetail, StockMovementEntry, StockRow } from "@/services/inventory";
import { batchKey, batchStatus, INVENTORY_LIMITS, isExpired, normalizeBatch, stockPosition } from "./inventory-rules";
import { pageArgs, runScoped, type Page } from "./scope";

// Branch-level medicine stock (migration 20261017000000_inventory).
//
// Quantity is never written by this module: every change is an INSERT into
// stock_movements, and the database trigger app.apply_stock_movement() locks
// the batch row, re-checks the caller, applies the delta (CHECK >= 0) and
// records the result in the same statement. This module locks the row first
// as well, so it can return clear errors instead of database exceptions; the
// trigger stays the authority. Movements are append-only; nothing is deleted.
//
// Dispensing against prescriptions is NOT implemented (separate future feature).

export const INVENTORY_VIEW = ["pharmacy.inventory.view", "pharmacy.inventory.manage", "pharmacy.manage"] as const;
export const INVENTORY_MANAGE = ["pharmacy.inventory.manage", "pharmacy.manage"] as const;

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Enter a real date.");
const L = INVENTORY_LIMITS;

const toDateKey = (d: Date) => d.toISOString().slice(0, 10); // @db.Date values arrive as UTC midnight

function branchWhere(ctx: TenantContext, branchId?: string) {
  if (branchId && branchId !== "all") {
    assertBranchAccess(ctx, branchId);
    return { branchId };
  }
  return ctx.branchId ? { branchId: ctx.branchId } : {};
}

/** Database refusals from the stock trigger/constraints, as API errors. Anything else is rethrown. */
function mapStockError(err: unknown): never {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  const text = parts.join(" | ");
  if ((err as { code?: string })?.code === "P2002" || /reversesMovementId|stock_movements_reversesMovementId_key/i.test(text)) {
    throw new DataError("INVALID_TRANSITION", "This movement has already been reversed.");
  }
  if (/insufficient stock|quantityOnHand_check/i.test(text)) throw new DataError("INSUFFICIENT_STOCK", "There isn't enough stock in this batch for that change.");
  if (/batch is expired/i.test(text)) throw new DataError("INVALID_INPUT", "This batch has expired. Stock can only be written off, not added.");
  if (/cannot be reversed|nothing to reverse/i.test(text)) throw new DataError("INVALID_TRANSITION", "This movement can't be reversed.");
  if (/stock movement: (not permitted|item not found)|row-level security/i.test(text)) throw new AuthError("FORBIDDEN");
  throw err;
}

// --- reads ----------------------------------------------------------------------

type ItemLite = { id: string; branchId: string; medicineId: string; batchNumber: string; expiryDate: Date; quantityOnHand: number };

async function describeGroups(
  tx: TenantTx,
  items: ItemLite[],
  levels: { branchId: string; medicineId: string; reorderLevel: number }[],
  today: string
): Promise<StockRow[]> {
  const groups = new Map<string, { branchId: string; medicineId: string; items: ItemLite[]; reorderLevel: number }>();
  const key = (b: string, m: string) => `${b}:${m}`;
  for (const it of items) {
    const g = groups.get(key(it.branchId, it.medicineId)) ?? { branchId: it.branchId, medicineId: it.medicineId, items: [], reorderLevel: 0 };
    g.items.push(it);
    groups.set(key(it.branchId, it.medicineId), g);
  }
  for (const l of levels) {
    const g = groups.get(key(l.branchId, l.medicineId)) ?? { branchId: l.branchId, medicineId: l.medicineId, items: [], reorderLevel: 0 };
    g.reorderLevel = l.reorderLevel;
    groups.set(key(l.branchId, l.medicineId), g);
  }
  if (groups.size === 0) return [];
  const all = [...groups.values()];
  const [medicines, branches] = await Promise.all([
    tx.medicine.findMany({ where: { id: { in: [...new Set(all.map((g) => g.medicineId))] } }, select: { id: true, name: true, genericName: true, strength: true, dosageForm: true } }),
    tx.branch.findMany({ where: { id: { in: [...new Set(all.map((g) => g.branchId))] } }, select: { id: true, name: true } }),
  ]);
  const med = new Map(medicines.map((m) => [m.id, m]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return all.map((g) => {
    const m = med.get(g.medicineId);
    const pos = stockPosition(g.items.map((i) => ({ expiryDate: toDateKey(i.expiryDate), quantityOnHand: i.quantityOnHand })), g.reorderLevel, today);
    return {
      medicineId: g.medicineId,
      branchId: g.branchId,
      branchName: branchName.get(g.branchId) ?? "—",
      name: m?.name ?? "—",
      genericName: m?.genericName ?? "",
      strength: m?.strength ?? "",
      dosageForm: m?.dosageForm.toLowerCase() ?? "",
      usableQuantity: pos.usableQuantity,
      expiredQuantity: pos.expiredQuantity,
      batchCount: g.items.length,
      nearestExpiry: pos.nearestExpiry,
      reorderLevel: g.reorderLevel,
      status: pos.status,
    };
  });
}

const itemLiteSelect = { id: true, branchId: true, medicineId: true, batchNumber: true, expiryDate: true, quantityOnHand: true } as const;

/** Every medicine-at-branch the user may see (stocked, or with a reorder level set), with derived status. */
async function loadRows(ctx: TenantContext, tx: TenantTx, branchId: string | undefined, search: string | undefined, today: string): Promise<StockRow[]> {
  const scope = { clinicId: ctx.clinicId, ...branchWhere(ctx, branchId) };
  let medicineFilter: { medicineId?: { in: string[] } } = {};
  if (search) {
    // Match on the medicine name or on any batch number, then load ALL batches of the matching medicines, so totals stay complete.
    const [byName, byBatch] = await Promise.all([
      tx.medicine.findMany({ where: { OR: [{ name: { contains: search, mode: "insensitive" } }, { genericName: { contains: search, mode: "insensitive" } }] }, select: { id: true } }),
      tx.inventoryItem.findMany({ where: { ...scope, batchNumber: { contains: search, mode: "insensitive" } }, select: { medicineId: true } }),
    ]);
    medicineFilter = { medicineId: { in: [...new Set([...byName.map((m) => m.id), ...byBatch.map((i) => i.medicineId)])] } };
  }
  const [items, levels] = await Promise.all([
    tx.inventoryItem.findMany({ where: { ...scope, ...medicineFilter }, select: itemLiteSelect }),
    tx.inventoryReorderLevel.findMany({ where: { ...scope, ...medicineFilter }, select: { branchId: true, medicineId: true, reorderLevel: true } }),
  ]);
  const rows = await describeGroups(tx, items, levels, today);
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength) || a.branchName.localeCompare(b.branchName));
}

export const listStockSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["in_stock", "low_stock", "out_of_stock", "expiring_soon", "expired", "all"]).optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listStock(ctx: TenantContext, input: ListStockParams, db?: TenantTx, now = new Date()): Promise<Page<StockRow>> {
  requirePermission(ctx, INVENTORY_VIEW);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  return runScoped(ctx, db, async (tx) => {
    const rows = (await loadRows(ctx, tx, input.branchId, input.search?.trim() || undefined, istTodayKey(now))).filter(
      (r) => !input.status || input.status === "all" || r.status === input.status
    );
    return { items: rows.slice(skip, skip + take), total: rows.length, page, pageSize };
  });
}

export async function getInventorySummary(ctx: TenantContext, branchId: string | undefined, db?: TenantTx, now = new Date()): Promise<LiveInventorySummary> {
  requirePermission(ctx, INVENTORY_VIEW);
  return runScoped(ctx, db, async (tx) => {
    const rows = await loadRows(ctx, tx, branchId, undefined, istTodayKey(now));
    const count = (s: StockRow["status"]) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      lowStock: count("low_stock"),
      outOfStock: count("out_of_stock"),
      expiringSoon: count("expiring_soon"),
      expired: count("expired"),
      canManage: hasAnyPermission(ctx, INVENTORY_MANAGE),
    };
  });
}

const TYPE_TO_UI = { RECEIPT: "receipt", ADJUSTMENT: "adjustment", REVERSAL: "reversal" } as const;

/** One medicine at one branch: batches, reorder level and movement history (newest first). */
export async function getStockDetail(ctx: TenantContext, branchId: string, medicineId: string, db?: TenantTx, now = new Date()): Promise<StockDetail> {
  requirePermission(ctx, INVENTORY_VIEW);
  if (!uuid.safeParse(branchId).success || !uuid.safeParse(medicineId).success) throw new AuthError("NOT_FOUND");
  if (ctx.branchId && ctx.branchId !== branchId) throw new AuthError("NOT_FOUND");
  const today = istTodayKey(now);
  return runScoped(ctx, db, async (tx) => {
    const [branch, medicine] = await Promise.all([
      tx.branch.findFirst({ where: { id: branchId, clinicId: ctx.clinicId }, select: { id: true } }),
      tx.medicine.findFirst({ where: { id: medicineId }, select: { id: true } }),
    ]);
    if (!branch || !medicine) throw new AuthError("NOT_FOUND");
    const scope = { clinicId: ctx.clinicId, branchId, medicineId };
    const [items, level, movements] = await Promise.all([
      tx.inventoryItem.findMany({ where: scope, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }], select: { ...itemLiteSelect, unitCostPaise: true, supplierName: true, createdAt: true } }),
      tx.inventoryReorderLevel.findFirst({ where: scope, select: { branchId: true, medicineId: true, reorderLevel: true } }),
      tx.stockMovement.findMany({
        where: { clinicId: ctx.clinicId, branchId, item: { medicineId } },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        take: 200,
        select: {
          id: true, inventoryItemId: true, type: true, quantityDelta: true, quantityAfter: true, reason: true, reference: true, occurredAt: true,
          reversesMovementId: true, actorUserId: true, item: { select: { batchNumber: true } }, reversedBy: { select: { id: true } },
        },
      }),
    ]);
    const [row] = await describeGroups(tx, items, level ? [level] : [{ branchId, medicineId, reorderLevel: 0 }], today);
    const actors = await tx.user.findMany({ where: { id: { in: [...new Set(movements.map((m) => m.actorUserId))] } }, select: { id: true, name: true } });
    const actorName = new Map(actors.map((a) => [a.id, a.name]));
    return {
      ...row,
      batches: items.map((i) => {
        const expiryDate = toDateKey(i.expiryDate);
        return {
          id: i.id,
          batchNumber: i.batchNumber,
          expiryDate,
          quantityOnHand: i.quantityOnHand,
          unitCostPaise: i.unitCostPaise ?? undefined,
          supplierName: i.supplierName ?? undefined,
          status: batchStatus({ expiryDate, quantityOnHand: i.quantityOnHand }, today),
          receivedAt: i.createdAt.toISOString(),
        };
      }),
      movements: movements.map(
        (m): StockMovementEntry => ({
          id: m.id,
          inventoryItemId: m.inventoryItemId,
          batchNumber: m.item.batchNumber,
          type: TYPE_TO_UI[m.type],
          quantityDelta: m.quantityDelta,
          quantityAfter: m.quantityAfter,
          reason: m.reason ?? undefined,
          reference: m.reference ?? undefined,
          actorName: actorName.get(m.actorUserId) ?? "—",
          occurredAt: m.occurredAt.toISOString(),
          reversesMovementId: m.reversesMovementId ?? undefined,
          reversedById: m.reversedBy?.id,
        })
      ),
      canManage: hasAnyPermission(ctx, INVENTORY_MANAGE),
    };
  });
}

// --- writes ---------------------------------------------------------------------

type LockedItem = { id: string; branchId: string; medicineId: string; batchNumber: string; expiryDate: string; quantityOnHand: number };

/** Locks the batch row until the transaction ends (RLS: only users who may change stock can lock it). */
async function lockItem(ctx: TenantContext, tx: TenantTx, itemId: string): Promise<LockedItem> {
  if (!uuid.safeParse(itemId).success) throw new AuthError("NOT_FOUND");
  const rows = await tx.$queryRaw<LockedItem[]>`
    SELECT id, "branchId", "medicineId", "batchNumber", "expiryDate"::text AS "expiryDate", "quantityOnHand"
    FROM inventory_items WHERE id = ${itemId}::uuid AND "clinicId" = ${ctx.clinicId}::uuid FOR UPDATE`;
  const item = rows[0];
  if (!item || (ctx.branchId && item.branchId !== ctx.branchId)) throw new AuthError("NOT_FOUND");
  return item;
}

/**
 * The only way this module changes stock. Explicit SQL (not Prisma create) so
 * only the granted columns are sent: the trigger sets scope, actor, time and
 * the resulting quantity, and the runtime role can't write those timestamps.
 */
async function insertMovement(
  ctx: TenantContext,
  tx: TenantTx,
  data: { inventoryItemId: string; branchId: string; type: "RECEIPT" | "ADJUSTMENT" | "REVERSAL"; quantityDelta: number; reason?: string; reference?: string; reversesMovementId?: string }
) {
  try {
    await tx.$executeRaw`
      INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", reason, reference, "reversesMovementId")
      VALUES (${ctx.clinicId}::uuid, ${data.branchId}::uuid, ${data.inventoryItemId}::uuid, ${data.type}::"StockMovementType", ${data.quantityDelta},
              ${ctx.userId}::uuid, ${data.reason || null}, ${data.reference || null}, ${data.reversesMovementId ?? null}::uuid)`;
  } catch (err) {
    mapStockError(err);
  }
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const receiveStockSchema = z
  .object({
    branchId: z.string().optional(),
    medicineId: uuid,
    batchNumber: z.string().trim().min(1, "Enter the batch number.").max(L.batchMaxLength),
    expiryDate: isoDate,
    quantity: z.number().int().min(1, "Receive at least 1 unit.").max(L.maxQuantity),
    unitCostPaise: z.number().int().min(0).max(L.maxUnitCostPaise).optional(),
    supplierName: optionalText(L.supplierMaxLength),
    reference: optionalText(L.referenceMaxLength),
  })
  .strict();

/**
 * Receives stock into a batch: creates the batch record (quantity 0) if it's
 * new, then records a RECEIPT movement. An existing batch must have the same
 * expiry date. Expired batches can't be received.
 */
export async function receiveStock(ctx: TenantContext, raw: ReceiveStockInput | unknown, db?: TenantTx, now = new Date()): Promise<StockDetail> {
  requirePermission(ctx, INVENTORY_MANAGE);
  const input = receiveStockSchema.parse(raw);
  const today = istTodayKey(now);
  if (isExpired(input.expiryDate, today)) throw new DataError("INVALID_INPUT", "That expiry date has passed. Expired stock can't be received.");
  const branchId = (input.branchId && input.branchId !== "all" ? input.branchId : undefined) ?? ctx.branchId;
  if (!branchId) throw new DataError("INVALID_INPUT", "Choose the branch receiving the stock.");
  assertBranchAccess(ctx, branchId);
  const batchNumber = normalizeBatch(input.batchNumber);

  const result = await runScoped(ctx, db, async (tx) => {
    const [branch, medicine] = await Promise.all([
      tx.branch.findFirst({ where: { id: branchId, clinicId: ctx.clinicId, status: "ACTIVE" }, select: { id: true } }),
      tx.medicine.findFirst({ where: { id: input.medicineId, isActive: true }, select: { id: true } }),
    ]);
    if (!branch) throw new DataError("INVALID_INPUT", "Choose an active branch of your clinic.");
    if (!medicine) throw new DataError("INVALID_INPUT", "Choose a medicine from the catalogue.");

    // Serialises "find or create" for this batch, so two receipts can't create it twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-batch:${ctx.clinicId}:${branchId}:${input.medicineId}:${batchKey(batchNumber)}`}))`;
    let existing = await tx.inventoryItem.findFirst({
      where: { clinicId: ctx.clinicId, branchId, medicineId: input.medicineId, batchNumber: { equals: batchNumber, mode: "insensitive" } },
      select: { id: true, expiryDate: true },
    });
    if (existing && toDateKey(existing.expiryDate) !== input.expiryDate) {
      throw new DataError("INVALID_INPUT", `Batch ${batchNumber} is already recorded at this branch with expiry ${toDateKey(existing.expiryDate)}. Check the batch number and expiry.`);
    }
    if (!existing) {
      // Explicit SQL: quantity starts at the column default (0) and createdAt is the database's; neither is writable by this role.
      const [created] = await tx.$queryRaw<{ id: string; expiryDate: Date }[]>`
        INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "unitCostPaise", "supplierName", "updatedAt")
        VALUES (${ctx.clinicId}::uuid, ${branchId}::uuid, ${input.medicineId}::uuid, ${batchNumber}, ${input.expiryDate}::date,
                ${input.unitCostPaise ?? null}::int, ${input.supplierName || null}, now())
        RETURNING id, "expiryDate"`;
      existing = created;
    }
    await lockItem(ctx, tx, existing.id);
    await insertMovement(ctx, tx, { inventoryItemId: existing.id, branchId, type: "RECEIPT", quantityDelta: input.quantity, reference: input.reference, reason: input.supplierName ? `Received from ${input.supplierName}` : undefined });
    return { branchId, medicineId: input.medicineId };
  });
  return getStockDetail(ctx, result.branchId, result.medicineId, db, now);
}

export const adjustStockSchema = z
  .object({
    quantityDelta: z
      .number()
      .int()
      .refine((n) => n !== 0, "The adjustment can't be zero.")
      .refine((n) => Math.abs(n) <= L.maxQuantity, `Adjust at most ${L.maxQuantity} units at a time.`),
    reason: z.string().trim().min(L.reasonMinLength, "Give a reason for the adjustment.").max(L.reasonMaxLength),
  })
  .strict();

/** Signed adjustment with a reason. Removing expired stock (write-off) is allowed; adding to an expired batch is not. */
export async function adjustStock(ctx: TenantContext, itemId: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<StockDetail> {
  requirePermission(ctx, INVENTORY_MANAGE);
  const input = adjustStockSchema.parse(raw);
  const item = await runScoped(ctx, db, async (tx) => {
    const locked = await lockItem(ctx, tx, itemId);
    if (input.quantityDelta > 0 && isExpired(locked.expiryDate, istTodayKey(now))) {
      throw new DataError("INVALID_INPUT", "This batch has expired. Stock can only be written off, not added.");
    }
    if (locked.quantityOnHand + input.quantityDelta < 0) {
      throw new DataError("INSUFFICIENT_STOCK", `Only ${locked.quantityOnHand} in this batch; you can remove at most that.`);
    }
    await insertMovement(ctx, tx, { inventoryItemId: locked.id, branchId: locked.branchId, type: "ADJUSTMENT", quantityDelta: input.quantityDelta, reason: input.reason });
    return locked;
  });
  return getStockDetail(ctx, item.branchId, item.medicineId, db, now);
}

export const reverseMovementSchema = z.object({ reason: z.string().trim().max(L.reasonMaxLength).optional() }).strict();

/** Records the exact opposite of a receipt or adjustment, once. Reversals themselves can't be reversed. */
export async function reverseMovement(ctx: TenantContext, movementId: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<StockDetail> {
  requirePermission(ctx, INVENTORY_MANAGE);
  const input = reverseMovementSchema.parse(raw ?? {});
  if (!uuid.safeParse(movementId).success) throw new AuthError("NOT_FOUND");
  const item = await runScoped(ctx, db, async (tx) => {
    const original = await tx.stockMovement.findFirst({
      where: { id: movementId, clinicId: ctx.clinicId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
      select: { id: true, inventoryItemId: true, type: true, quantityDelta: true, reversedBy: { select: { id: true } } },
    });
    if (!original) throw new AuthError("NOT_FOUND");
    const locked = await lockItem(ctx, tx, original.inventoryItemId);
    if (original.type === "REVERSAL") throw new DataError("INVALID_TRANSITION", "A reversal can't itself be reversed.");
    // Re-read under the lock: a concurrent reversal of the same movement is caught here (and by the unique constraint).
    const already = await tx.stockMovement.findFirst({ where: { reversesMovementId: original.id }, select: { id: true } });
    if (original.reversedBy || already) throw new DataError("INVALID_TRANSITION", "This movement has already been reversed.");
    const delta = -original.quantityDelta;
    if (delta > 0 && isExpired(locked.expiryDate, istTodayKey(now))) {
      throw new DataError("INVALID_INPUT", "This batch has expired, so stock can't be added back to it.");
    }
    if (locked.quantityOnHand + delta < 0) {
      throw new DataError("INSUFFICIENT_STOCK", `Reversing would take the batch below zero (only ${locked.quantityOnHand} left).`);
    }
    await insertMovement(ctx, tx, { inventoryItemId: locked.id, branchId: locked.branchId, type: "REVERSAL", quantityDelta: delta, reason: input.reason, reversesMovementId: original.id });
    return locked;
  });
  return getStockDetail(ctx, item.branchId, item.medicineId, db, now);
}

export const reorderLevelSchema = z.object({ reorderLevel: z.number().int().min(0).max(L.maxReorderLevel) }).strict();

/** Sets the reorder level for a medicine at a branch (0 = no low-stock alert). */
export async function setReorderLevel(ctx: TenantContext, branchId: string, medicineId: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<StockDetail> {
  requirePermission(ctx, INVENTORY_MANAGE);
  const { reorderLevel } = reorderLevelSchema.parse(raw);
  if (!uuid.safeParse(branchId).success || !uuid.safeParse(medicineId).success) throw new AuthError("NOT_FOUND");
  assertBranchAccess(ctx, branchId);
  await runScoped(ctx, db, async (tx) => {
    const [branch, medicine] = await Promise.all([
      tx.branch.findFirst({ where: { id: branchId, clinicId: ctx.clinicId }, select: { id: true } }),
      tx.medicine.findFirst({ where: { id: medicineId }, select: { id: true } }),
    ]);
    if (!branch || !medicine) throw new AuthError("NOT_FOUND");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-reorder:${ctx.clinicId}:${branchId}:${medicineId}`}))`;
    const existing = await tx.inventoryReorderLevel.findFirst({ where: { clinicId: ctx.clinicId, branchId, medicineId }, select: { id: true } });
    if (existing) await tx.inventoryReorderLevel.update({ where: { id: existing.id }, data: { reorderLevel } });
    else await tx.inventoryReorderLevel.create({ data: { clinicId: ctx.clinicId, branchId, medicineId, reorderLevel } });
  });
  return getStockDetail(ctx, branchId, medicineId, db, now);
}

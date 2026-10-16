import "server-only";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import { istTodayKey } from "@/lib/ist";
import type { ExpensePage, LiveExpense, LiveExpenseCategory } from "@/lib/live-types";
import type { ExpenseCategory as DbExpenseCategory } from "@/generated/prisma/client";
import { expenseInputSchema, expenseQuerySchema, isUuid, monthStart, rupeesToPaise, voidExpenseSchema } from "./clinic-admin-rules";
import { pageArgs, runScoped } from "./scope";

// Clinic expenses (P7). Recorded per branch in integer paise; never edited or
// deleted — a wrong entry is voided with a reason. RLS enforces the clinic,
// the branch scope and the permissions independently of these checks.

export const EXPENSE_VIEW = ["billing.manage", "financial_reports.view"] as const;
export const EXPENSE_MANAGE = ["billing.manage"] as const;

const select = {
  id: true, branchId: true, category: true, description: true, amountPaise: true, expenseDate: true, paidTo: true, reference: true,
  status: true, voidReason: true, createdAt: true,
  branch: { select: { name: true } },
  createdBy: { select: { name: true } },
} as const;

type Row = {
  id: string; branchId: string; category: DbExpenseCategory; description: string; amountPaise: number; expenseDate: Date; paidTo: string | null; reference: string | null;
  status: "RECORDED" | "VOIDED"; voidReason: string | null; createdAt: Date; branch: { name: string }; createdBy: { name: string };
};

const toUi = (e: Row): LiveExpense => ({
  id: e.id,
  branchId: e.branchId,
  branchName: e.branch.name,
  category: e.category.toLowerCase() as LiveExpenseCategory,
  description: e.description,
  amount: e.amountPaise / 100,
  date: e.expenseDate.toISOString().slice(0, 10),
  paidTo: e.paidTo,
  reference: e.reference,
  status: e.status === "RECORDED" ? "recorded" : "voided",
  voidReason: e.voidReason,
  recordedBy: e.createdBy.name,
  createdAt: e.createdAt.toISOString(),
});

const branchScope = (ctx: TenantContext) => (ctx.branchId ? { branchId: ctx.branchId } : {});
const dateOnly = (key: string) => new Date(`${key}T00:00:00Z`);

export async function listExpenses(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<ExpensePage> {
  requirePermission(ctx, EXPENSE_VIEW);
  const input = expenseQuerySchema.parse(raw ?? {});
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize ?? 10, 100);
  const search = input.search?.trim();
  const status = input.status ?? "recorded";
  const where = {
    clinicId: ctx.clinicId,
    ...branchScope(ctx),
    ...(input.branchId && !ctx.branchId ? { branchId: input.branchId } : {}),
    ...(input.category ? { category: input.category.toUpperCase() as DbExpenseCategory } : {}),
    ...(status !== "all" ? { status: status === "recorded" ? ("RECORDED" as const) : ("VOIDED" as const) } : {}),
    ...(search
      ? { OR: [{ description: { contains: search, mode: "insensitive" as const } }, { paidTo: { contains: search, mode: "insensitive" as const } }, { reference: { contains: search, mode: "insensitive" as const } }] }
      : {}),
  };
  const today = istTodayKey(now);
  return runScoped(ctx, db, async (tx) => {
    const [rows, total, month] = await Promise.all([
      tx.expense.findMany({ where, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip, take, select }),
      tx.expense.count({ where }),
      tx.expense.aggregate({
        where: {
          clinicId: ctx.clinicId,
          ...branchScope(ctx),
          ...(input.branchId && !ctx.branchId ? { branchId: input.branchId } : {}),
          status: "RECORDED",
          expenseDate: { gte: dateOnly(monthStart(today)), lte: dateOnly(today) },
        },
        _sum: { amountPaise: true },
      }),
    ]);
    return { items: rows.map(toUi), total, page, pageSize, monthTotal: (month._sum.amountPaise ?? 0) / 100, canManage: hasAnyPermission(ctx, EXPENSE_MANAGE) };
  });
}

export async function createExpense(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<LiveExpense> {
  requirePermission(ctx, EXPENSE_MANAGE);
  const input = expenseInputSchema(istTodayKey(now)).parse(raw);
  if (ctx.branchId && input.branchId !== ctx.branchId) throw new AuthError("FORBIDDEN");
  return runScoped(ctx, db, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, clinicId: ctx.clinicId }, select: { status: true } });
    if (!branch) throw new DataError("INVALID_INPUT", "Choose one of this clinic's branches.");
    if (branch.status !== "ACTIVE") throw new DataError("INVALID_INPUT", "That branch is inactive.");
    // Explicit columns: the runtime role may insert only these (status, void and
    // timestamp columns take their database defaults), so a Prisma create — which
    // also sends the status default — would be refused.
    const category = input.category.toUpperCase() as DbExpenseCategory;
    const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO expenses ("id", "clinicId", "branchId", "category", "description", "amountPaise", "expenseDate", "paidTo", "reference", "createdByUserId", "updatedAt")
      VALUES (gen_random_uuid(), ${ctx.clinicId}::uuid, ${input.branchId}::uuid, ${category}::"ExpenseCategory", ${input.description}, ${rupeesToPaise(input.amount)},
              ${input.date}::date, ${input.paidTo}, ${input.reference}, ${ctx.userId}::uuid, now())
      RETURNING id`;
    return toUi(await tx.expense.findUniqueOrThrow({ where: { id }, select }));
  });
}

export async function voidExpense(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<LiveExpense> {
  requirePermission(ctx, EXPENSE_MANAGE);
  if (!isUuid(id)) throw new AuthError("NOT_FOUND");
  const { reason } = voidExpenseSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const existing = await tx.expense.findFirst({ where: { id, clinicId: ctx.clinicId, ...branchScope(ctx) }, select: { status: true } });
    if (!existing) throw new AuthError("NOT_FOUND");
    if (existing.status !== "RECORDED") throw new DataError("INVALID_TRANSITION", "This expense is already voided.");
    // Guarded on status so two concurrent voids can't both succeed.
    const changed = await tx.expense.updateMany({
      where: { id, clinicId: ctx.clinicId, status: "RECORDED" },
      data: { status: "VOIDED", voidReason: reason, voidedByUserId: ctx.userId, voidedAt: new Date() },
    });
    if (changed.count !== 1) throw new DataError("INVALID_TRANSITION", "This expense is already voided.");
    return toUi(await tx.expense.findUniqueOrThrow({ where: { id }, select }));
  });
}

/** Recorded expenses this IST month in the user's scope (rupees), or null without permission. */
export async function monthExpenses(ctx: TenantContext, tx: TenantTx, now = new Date()): Promise<number | null> {
  if (!hasAnyPermission(ctx, EXPENSE_VIEW)) return null;
  const today = istTodayKey(now);
  const sum = await tx.expense.aggregate({
    where: { clinicId: ctx.clinicId, ...branchScope(ctx), status: "RECORDED", expenseDate: { gte: dateOnly(monthStart(today)), lte: dateOnly(today) } },
    _sum: { amountPaise: true },
  });
  return (sum._sum.amountPaise ?? 0) / 100;
}

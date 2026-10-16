import { apiRoute } from "@/server/api/route-handler";
import { EXPENSE_MANAGE, voidExpense } from "@/server/data/expenses";

/** Void a recorded expense with a reason (it stays in the ledger, excluded from totals). */
export const POST = apiRoute<{ id: string }>({ permission: EXPENSE_MANAGE, resource: "POST /api/v1/expenses/[id]/void" }, async ({ ctx, params, request }) =>
  voidExpense(ctx, params.id, await request.json())
);

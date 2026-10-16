import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { createExpense, EXPENSE_MANAGE, EXPENSE_VIEW, listExpenses } from "@/server/data/expenses";

/** Expenses in the caller's branch scope: ?search=&category=&branchId=&status=&page=&pageSize= */
export const GET = apiRoute({ permission: EXPENSE_VIEW, resource: "GET /api/v1/expenses" }, ({ ctx, request }) => listExpenses(ctx, searchParamsOf(request)));

/** Record an expense (billing.manage). */
export const POST = apiRoute({ permission: EXPENSE_MANAGE, resource: "POST /api/v1/expenses" }, async ({ ctx, request }) => createExpense(ctx, await request.json()));

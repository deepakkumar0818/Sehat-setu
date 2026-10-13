import "server-only";
import { withTenantDb, type TenantTx } from "@/server/db/tenant";
import type { TenantContext } from "@/server/auth/authorize";

/**
 * Runs `fn` with RLS scoped to `ctx`. Callers normally omit `db`, giving each
 * operation its own tenant transaction. Passing `db` (a transaction that
 * already has the SAME context pinned via withTenantDb) composes operations
 * into one transaction — used by integration tests to roll back their writes.
 */
export function runScoped<T>(ctx: TenantContext, db: TenantTx | undefined, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db ? fn(db) : withTenantDb(ctx, fn);
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageArgs(page?: number, pageSize?: number, max = 100) {
  const size = Math.min(Math.max(Math.trunc(pageSize ?? 10), 1), max);
  const p = Math.max(Math.trunc(page ?? 1), 1);
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

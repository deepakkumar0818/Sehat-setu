import "server-only";
import { withPatientDb, withTenantDb, type TenantTx } from "@/server/db/tenant";
import type { PatientContext, TenantContext } from "@/server/auth/authorize";

/**
 * Runs `fn` with RLS scoped to `ctx`. Callers normally omit `db`, giving each
 * operation its own tenant transaction. Passing `db` (a transaction that
 * already has the SAME context pinned via withTenantDb) composes operations
 * into one transaction — used by integration tests to roll back their writes.
 */
export function runScoped<T>(ctx: TenantContext, db: TenantTx | undefined, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db ? fn(db) : withTenantDb(ctx, fn);
}

/**
 * Runs `fn` with RLS scoped to a verified patient-portal context (P6.3): only
 * the user and clinic are pinned, and the database derives the patient records
 * from the server-side link (app.current_patient_ids()). `db` composes into an
 * existing transaction with the same context pinned (tests).
 */
export function runPatientScoped<T>(ctx: PatientContext, db: TenantTx | undefined, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db ? fn(db) : withPatientDb(ctx, fn);
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

import "server-only";
import { prisma } from "@/server/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PatientContext, TenantContext } from "@/server/auth/authorize";

// Every application query runs inside one of these transactions. They pin the
// verified tenant context with set_config(..., is_local => true), which the
// RLS policies in prisma/migrations/*_rls_and_app_role read. is_local settings
// end with the transaction, so a pooled connection can't carry one request's
// context into the next. The runtime role (sehat_app) cannot bypass RLS.

export type TenantTx = Prisma.TransactionClient;

/** Pins a verified tenant context on the current transaction (transaction-local settings). */
export async function pinTenantContext(tx: TenantTx, ctx: TenantContext): Promise<void> {
  await tx.$executeRaw`SELECT
    set_config('app.auth_user_id', ${ctx.authUserId}, true),
    set_config('app.user_id', ${ctx.userId}, true),
    set_config('app.clinic_id', ${ctx.clinicId}, true),
    set_config('app.branch_id', ${ctx.branchId ?? ""}, true)`;
}

/** Run `fn` with RLS scoped to the verified clinic (and branch, if restricted). */
export async function withTenantDb<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await pinTenantContext(tx, ctx);
    return fn(tx);
  });
}

/**
 * Run `fn` for a verified patient-portal request. Only user and clinic are
 * pinned: RLS (app.current_patient_ids) then exposes just the patient records
 * an administrator linked to this user, and their appointments/records.
 */
export async function withPatientDb<T>(ctx: PatientContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT
      set_config('app.auth_user_id', ${ctx.authUserId}, true),
      set_config('app.user_id', ${ctx.userId}, true),
      set_config('app.clinic_id', ${ctx.clinicId}, true),
      set_config('app.branch_id', '', true)`;
    return fn(tx);
  });
}

/**
 * Run `fn` with only the signed-in user's identity pinned (no clinic yet).
 * RLS then exposes just that user's own row and own memberships — used to
 * resolve which clinics they belong to.
 */
export async function withIdentityDb<T>(authUserId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  // READ COMMITTED: each statement sees rows committed by concurrent requests,
  // which first-sign-in linking relies on (see src/server/auth/link-user.ts).
  // It is Postgres's (and this database's) default, so it isn't requested
  // explicitly: Prisma would send SET TRANSACTION ISOLATION LEVEL as an extra
  // round-trip on every authenticated request.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authUserId}, true)`;
    return fn(tx);
  });
}

/**
 * Run `fn` for a verified, linked user who may not belong to any clinic yet
 * (e.g. accepting a staff invitation). Pins only the user's own identity: RLS
 * then exposes nothing clinic-scoped; the invitation functions check ownership.
 */
export async function withUserDb<T>(identity: { authUserId: string; userId: string }, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT
      set_config('app.auth_user_id', ${identity.authUserId}, true),
      set_config('app.user_id', ${identity.userId}, true),
      set_config('app.clinic_id', '', true),
      set_config('app.branch_id', '', true)`;
    return fn(tx);
  });
}

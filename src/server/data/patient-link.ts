import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type TenantContext, type VerifiedAuthUser } from "@/server/auth/authorize";
import { prisma } from "@/server/prisma";
import type { TenantTx } from "@/server/db/tenant";
import { DataError } from "@/server/api/errors";
import type { PortalLinkCode, PortalLinkStatus } from "@/lib/live-types";
import { runScoped } from "./scope";
import { isSelfRegisterResult, selfRegistrationSchema, isRedeemResult, issueLinkCodeSchema, mapPatientLinkDbError, PORTAL_LINK_PERMISSION, redeemLinkCodeSchema, type RedeemResult, type SelfRegisterResult } from "./patient-link-rules";

// Patient portal linking codes (P6.4, migration 20261022000000_patient_link_codes).
//
// Staff (patient.portal_link: Administrator, Receptionist) issue a one-time code
// for ONE patient of their clinic after the clinic's identity check; the
// patient enters it after registering and verifying their email. Every step is
// a SECURITY DEFINER function that re-checks the caller from the pinned
// session; the runtime role has no privileges on the code tables. The code is
// returned to the issuing staff member once and is never stored, logged or
// audited in clear (only its SHA-256 hash is kept).

const idSchema = z.string().uuid();

function patientIdOrNotFound(id: string): string {
  if (!idSchema.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return id;
}

export async function getPortalLinkStatus(ctx: TenantContext, patientId: string, db?: TenantTx): Promise<PortalLinkStatus> {
  requirePermission(ctx, PORTAL_LINK_PERMISSION);
  const id = patientIdOrNotFound(patientId);
  return runScoped(ctx, db, async (tx) => {
    try {
      const [row] = await tx.$queryRaw<{ linked: boolean; code_issued_at: Date | null; code_expires_at: Date | null }[]>`
        SELECT linked, code_issued_at, code_expires_at FROM app.patient_portal_link_status(${id}::uuid)`;
      return {
        linked: row.linked,
        activeCode: row.code_expires_at ? { issuedAt: row.code_issued_at!.toISOString(), expiresAt: row.code_expires_at.toISOString() } : null,
      };
    } catch (err) {
      mapPatientLinkDbError(err);
    }
  });
}

/** Issues a code (revoking any previous one). The plain code is in the response ONLY. */
export async function issuePortalLinkCode(ctx: TenantContext, patientId: string, input: unknown, db?: TenantTx): Promise<PortalLinkCode> {
  requirePermission(ctx, PORTAL_LINK_PERMISSION);
  const id = patientIdOrNotFound(patientId);
  const data = issueLinkCodeSchema.parse(input);
  return runScoped(ctx, db, async (tx) => {
    try {
      const [row] = await tx.$queryRaw<{ code: string; expires_at: Date }[]>`
        SELECT code, expires_at FROM app.issue_patient_link_code(${id}::uuid, ${data.identityVerified})`;
      return { code: row.code, expiresAt: row.expires_at.toISOString() };
    } catch (err) {
      mapPatientLinkDbError(err);
    }
  });
}

export async function revokePortalLinkCode(ctx: TenantContext, patientId: string, db?: TenantTx): Promise<{ revoked: boolean }> {
  requirePermission(ctx, PORTAL_LINK_PERMISSION);
  const id = patientIdOrNotFound(patientId);
  return runScoped(ctx, db, async (tx) => {
    try {
      const [row] = await tx.$queryRaw<{ revoked: boolean }[]>`SELECT app.revoke_patient_link_code(${id}::uuid) AS revoked`;
      return { revoked: row.revoked };
    } catch (err) {
      mapPatientLinkDbError(err);
    }
  });
}

/**
 * Redeems a code for the signed-in Supabase user. `authUser` must come from
 * supabase.auth.getUser() (never the browser); its email must be confirmed.
 * Only the Supabase identity is pinned: the patient and clinic come from the
 * code row inside the database. Failures are COMMITTED (the attempt limits
 * depend on it), so the function reports them as a result rather than an error.
 */
export async function redeemPortalLinkCode(authUser: VerifiedAuthUser, input: unknown, db?: TenantTx): Promise<{ result: RedeemResult; clinicId: string | null }> {
  if (!authUser.emailConfirmed || !authUser.email) throw new DataError("EMAIL_NOT_VERIFIED", "Confirm your email address, then sign in again.");
  const { code } = redeemLinkCodeSchema.parse(input);
  const run = async (tx: TenantTx) => {
    await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authUser.id}, true), set_config('app.user_id', '', true),
      set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`;
    try {
      const [row] = await tx.$queryRaw<{ result: string; clinic_id: string | null }[]>`
        SELECT result, clinic_id::text AS clinic_id FROM app.redeem_patient_link_code(${code}, ${authUser.email!.trim().toLowerCase()})`;
      if (!isRedeemResult(row?.result)) throw new Error("unexpected redeem result");
      return { result: row.result, clinicId: row.clinic_id };
    } catch (err) {
      mapPatientLinkDbError(err);
    }
  };
  return db ? run(db) : prisma.$transaction(run);
}

/**
 * The clinic new self-registered patients join: SELF_REGISTRATION_CLINIC, a
 * clinic code set by the operator (never the patient). Unset → the single
 * active clinic, if there is exactly one.
 */
function selfRegistrationClinic(): string | null {
  return process.env.SELF_REGISTRATION_CLINIC?.trim() || null;
}

/**
 * Creates the patient record for a confirmed login whose email is on NO record
 * yet, from the details the patient registered with, and links it (migration
 * 20261027000000). If any record already carries the email the answer is
 * NEEDS_CODE: nothing is created or linked, and only the clinic-issued
 * single-use code (redeemPortalLinkCode) connects that record. `authUser` must
 * come from supabase.auth.getUser(); the clinic comes from the server setting.
 */
export async function registerSelfPatient(authUser: VerifiedAuthUser, input: unknown): Promise<{ result: SelfRegisterResult; clinicId: string | null }> {
  if (!authUser.emailConfirmed || !authUser.email) throw new DataError("EMAIL_NOT_VERIFIED", "Confirm your email address, then sign in again.");
  const d = selfRegistrationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${authUser.id}, true), set_config('app.user_id', '', true),
      set_config('app.clinic_id', '', true), set_config('app.branch_id', '', true)`;
    try {
      const [row] = await tx.$queryRaw<{ result: string; clinic_id: string | null }[]>`
        SELECT result, clinic_id::text AS clinic_id
          FROM app.register_self_patient(${selfRegistrationClinic()}, ${authUser.email!.trim().toLowerCase()}, ${d.name}, ${d.phone}, ${d.dateOfBirth}::date, ${d.gender})`;
      if (!isSelfRegisterResult(row?.result)) throw new Error("unexpected register result");
      return { result: row.result, clinicId: row.clinic_id };
    } catch (err) {
      mapPatientLinkDbError(err);
    }
  });
}

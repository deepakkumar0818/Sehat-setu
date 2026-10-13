import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { withUserDb, type TenantTx } from "@/server/db/tenant";
import { createSupabaseMailer, emailSendingConfigured, sendInvitationEmail, type InvitationMailer } from "@/server/supabase-admin";
import { DataError } from "@/server/api/errors";
import type { VerifiedIdentity } from "@/server/api/route-handler";
import type { InvitableRole, InvitationPage, InvitationResult, MyInvitation, StaffInvitation } from "@/lib/live-types";
import { INVITATION_MANAGE, INVITATION_VIEW } from "./people";
import {
  createInvitationSchema,
  deliveryState,
  featureUnavailable,
  invitationActions,
  invitationState,
  isMissingP5Schema,
  listInvitationsSchema,
  mapInvitationDbError,
  rupeesToPaise,
} from "./invitation-rules";
import { pageArgs, runScoped } from "./scope";
import { invitationsReady } from "./p5-schema";

// Staff invitations (migration 20261019000100_staff_invitations).
//
// Every write is a call to a SECURITY DEFINER database function that re-checks
// the caller from the pinned session (Administrator = user.create; doctor
// invitations also doctor.manage), the branch scope, the limits and the
// duplicate rules. The runtime role has SELECT only on the invitation tables.
//
// Sending happens AFTER the invitation is committed (never inside a database
// transaction), and its outcome is recorded in a second transaction. A sent
// email is reported as "sent" — never as "accepted".

const DOCTOR_MANAGE = ["doctor.manage"] as const;

const select = {
  id: true, email: true, name: true, status: true, expiresAt: true, deliveryStatus: true, deliveryError: true,
  sendAttempts: true, lastAttemptAt: true, lastSentAt: true, createdAt: true, acceptedAt: true, revokedAt: true,
  branch: { select: { id: true, name: true } },
  role: { select: { key: true } },
  invitedBy: { select: { name: true } },
  doctorDetails: { select: { registrationNumber: true, specialty: { select: { name: true } } } },
} as const;

type Row = {
  id: string; email: string; name: string; status: "PENDING" | "ACCEPTED" | "REVOKED"; expiresAt: Date;
  deliveryStatus: "NOT_SENT" | "SENDING" | "SENT" | "FAILED"; deliveryError: string | null; sendAttempts: number;
  lastAttemptAt: Date | null; lastSentAt: Date | null; createdAt: Date; acceptedAt: Date | null; revokedAt: Date | null;
  branch: { id: string; name: string }; role: { key: string }; invitedBy: { name: string } | null;
  doctorDetails: { registrationNumber: string; specialty: { name: string } } | null;
};

function toDto(row: Row, canManage: boolean, now: Date): StaffInvitation {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleKey: row.role.key as InvitableRole,
    branch: row.branch,
    status: invitationState(row, now),
    delivery: deliveryState(row, now),
    deliveryError: row.deliveryError,
    sendAttempts: row.sendAttempts,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    invitedByName: row.invitedBy?.name ?? null,
    doctor: row.doctorDetails ? { specialtyName: row.doctorDetails.specialty.name, registrationNumber: row.doctorDetails.registrationNumber } : null,
    ...invitationActions(row, canManage, now),
  };
}

/** Runs `fn`, turning "the migration isn't applied yet" into a clear 503 instead of a 500. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingP5Schema(err)) throw featureUnavailable("Staff invitations");
    throw err;
  }
}

async function loadOne(ctx: TenantContext, tx: TenantTx, id: string, now = new Date()): Promise<StaffInvitation> {
  const row = await tx.staffInvitation.findFirst({ where: { id, clinicId: ctx.clinicId }, select });
  if (!row) throw new AuthError("NOT_FOUND");
  return toDto(row as Row, hasAnyPermission(ctx, INVITATION_MANAGE), now);
}

export async function listInvitations(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<InvitationPage> {
  requirePermission(ctx, INVITATION_VIEW);
  const input = listInvitationsSchema.parse(raw);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 50);
  const canManage = hasAnyPermission(ctx, INVITATION_MANAGE);
  const statusWhere =
    input.status === "pending" ? { status: "PENDING" as const, expiresAt: { gt: now } }
    : input.status === "expired" ? { status: "PENDING" as const, expiresAt: { lte: now } }
    : input.status === "accepted" ? { status: "ACCEPTED" as const }
    : input.status === "revoked" ? { status: "REVOKED" as const }
    : {};
  // RLS also limits rows to the clinic and the user's branch; the explicit filters keep queries honest.
  const where = { clinicId: ctx.clinicId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...statusWhere };
  return guarded(() =>
    runScoped(ctx, db, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.staffInvitation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take, select }),
        tx.staffInvitation.count({ where }),
      ]);
      return { items: rows.map((r) => toDto(r as Row, canManage, now)), total, page, pageSize, canManage, emailConfigured: canManage ? emailSendingConfigured() : null };
    })
  );
}

/** Sends the email for an already-claimed attempt and records the outcome (never throws for email failures). */
async function deliver(ctx: TenantContext, db: TenantTx | undefined, id: string, email: string, mailer?: InvitationMailer | null): Promise<InvitationResult["delivery"]> {
  const result = mailer === undefined ? await sendInvitationEmail(email) : await sendInvitationEmail(email, mailer);
  try {
    await runScoped(ctx, db, (tx) => tx.$executeRaw`SELECT app.record_invitation_delivery(${id}::uuid, ${result.ok}, ${result.ok ? null : result.error}::text)`);
  } catch (err) {
    // The email outcome stays "sending" and is shown as "unknown" after two minutes; resending is safe.
    console.error("[invitations] couldn't record delivery outcome", (err as { code?: string })?.code ?? "error");
  }
  return result.ok ? { status: "sent" } : { status: "failed", error: result.error };
}

export interface DeliveryDeps {
  /** Test seam: replaces the Supabase mailer (null = not configured). */
  mailer?: InvitationMailer | null;
}

export async function createInvitation(ctx: TenantContext, raw: unknown, db?: TenantTx, deps: DeliveryDeps = {}): Promise<InvitationResult> {
  requirePermission(ctx, INVITATION_MANAGE);
  const input = createInvitationSchema.parse(raw);
  if (input.roleKey === "DOCTOR") requirePermission(ctx, DOCTOR_MANAGE);
  const d = input.doctor;
  const id = await runScoped(ctx, db, async (tx) => {
    // Never create (or email) an invitation until the database is fully ready (see p5-schema.ts).
    if (!(await invitationsReady(tx))) throw featureUnavailable("Staff invitations");
    try {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT app.create_staff_invitation(
          ${input.email}, ${input.name}, ${input.roleKey}, ${input.branchId}::uuid, ${input.phone}::text,
          ${d?.specialtyId ?? null}::uuid, ${d?.qualifications ?? null}::text, ${d?.registrationNumber ?? null}::text,
          ${d?.experienceYears ?? null}::integer, ${d ? rupeesToPaise(d.consultationFee) : null}::integer, ${d?.onlineConsultation ?? null}::boolean
        )::text AS id`;
      return rows[0].id;
    } catch (err) {
      mapInvitationDbError(err);
    }
  });
  // Committed (unless the caller supplied a transaction). Same response for new and existing accounts.
  const delivery = await deliver(ctx, db, id, input.email, deps.mailer);
  const invitation = await runScoped(ctx, db, (tx) => loadOne(ctx, tx, id));
  return { invitation, delivery };
}

const idSchema = z.string().uuid();

export async function resendInvitation(ctx: TenantContext, id: string, db?: TenantTx, deps: DeliveryDeps = {}): Promise<InvitationResult> {
  requirePermission(ctx, INVITATION_MANAGE);
  if (!idSchema.safeParse(id).success) throw new AuthError("NOT_FOUND");
  // Checked BEFORE the database call: a resend that can't send must not use up
  // one of the 10 attempts, restart the cooldown or renew the expiry.
  const mailer = deps.mailer === undefined ? createSupabaseMailer() : deps.mailer;
  if (!mailer) {
    throw new DataError(
      "EMAIL_NOT_CONFIGURED",
      "Email sending isn't configured on the server: SUPABASE_SECRET_KEY is missing or invalid in the server environment (.env.local). Nothing was resent and no attempt was used."
    );
  }
  const email = await runScoped(ctx, db, async (tx) => {
    try {
      const rows = await tx.$queryRaw<{ email: string }[]>`SELECT app.resend_staff_invitation(${id}::uuid) AS email`;
      return rows[0].email;
    } catch (err) {
      mapInvitationDbError(err);
    }
  });
  const delivery = await deliver(ctx, db, id, email, mailer);
  const invitation = await runScoped(ctx, db, (tx) => loadOne(ctx, tx, id));
  return { invitation, delivery };
}

export async function revokeInvitation(ctx: TenantContext, id: string, db?: TenantTx): Promise<{ invitation: StaffInvitation }> {
  requirePermission(ctx, INVITATION_MANAGE);
  if (!idSchema.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    try {
      // $executeRaw: the function returns void, which $queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT app.revoke_staff_invitation(${id}::uuid)`;
    } catch (err) {
      mapInvitationDbError(err);
    }
    return { invitation: await loadOne(ctx, tx, id) };
  });
}

// --- The invitee's side (no clinic membership yet) -----------------------------------

type Runner = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
const userDb = (identity: VerifiedIdentity, db?: TenantTx): Runner => (fn) => (db ? fn(db) : withUserDb(identity, fn));

export async function listMyInvitations(identity: VerifiedIdentity, db?: TenantTx): Promise<{ items: MyInvitation[] }> {
  return guarded(() =>
    userDb(identity, db)(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; clinic_name: string; branch_name: string; role_key: string; expires_at: Date; expired: boolean }[]>`
        SELECT * FROM app.my_staff_invitations(${identity.verifiedEmail})`;
      return {
        items: rows.map((r) => ({ id: r.id, clinicName: r.clinic_name, branchName: r.branch_name, roleKey: r.role_key as InvitableRole, expiresAt: r.expires_at.toISOString(), expired: r.expired })),
      };
    })
  );
}

/** Explicit acceptance. Creates the membership (and doctor profile) atomically in the database function. */
export async function acceptInvitation(identity: VerifiedIdentity, id: string, db?: TenantTx): Promise<{ clinicId: string }> {
  if (!idSchema.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return userDb(identity, db)(async (tx) => {
    try {
      const rows = await tx.$queryRaw<{ clinic_id: string }[]>`SELECT app.accept_staff_invitation(${id}::uuid, ${identity.verifiedEmail})::text AS clinic_id`;
      return { clinicId: rows[0].clinic_id };
    } catch (err) {
      mapInvitationDbError(err);
    }
  });
}

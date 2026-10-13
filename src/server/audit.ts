import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/server/prisma";

// Security-event logging. Rows are written by the database function
// app.log_event (SECURITY DEFINER): the runtime role has no INSERT privilege
// on audit_events, and the function takes the actor and clinic from this
// transaction's context rather than from arguments. Never pass passwords,
// tokens, credentials, or clinical content here.

export type AuditAction =
  | "auth.sign_in"
  | "auth.sign_out"
  | "auth.account_linked"
  | "access.denied";

export interface AuditEventInput {
  action: AuditAction;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  /** Who, when known (from a verified session). */
  actor?: { userId?: string | null; authUserId?: string | null; clinicId?: string | null };
  /** Non-user actor or the attempted email of a failed sign-in. */
  actorLabel?: string;
  targetType?: string;
  targetId?: string;
  /** Machine-readable reason code. */
  reason?: string;
  /** Small, non-sensitive context (e.g. the request path). */
  metadata?: Record<string, string | number | boolean | null>;
}

async function clientIp(): Promise<string | undefined> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  } catch {
    return undefined; // outside a request scope
  }
}

/**
 * Records a security event. Never throws: an audit-write failure is reported
 * to the server log but doesn't change the outcome of the request.
 */
export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    const ip = await clientIp();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.user_id', ${event.actor?.userId ?? ""}, true),
        set_config('app.auth_user_id', ${event.actor?.authUserId ?? ""}, true),
        set_config('app.clinic_id', ${event.actor?.clinicId ?? ""}, true)`;
      await tx.$executeRaw`SELECT app.log_event(
        ${event.action}, ${event.outcome}, ${event.targetType ?? null}, ${event.targetId ?? null},
        ${event.reason ?? null}, ${event.actorLabel?.slice(0, 320) ?? null}, ${ip ?? null},
        ${event.metadata ? JSON.stringify(event.metadata) : null}::jsonb)`;
    });
  } catch (err) {
    console.error("[audit] failed to record event", event.action, err instanceof Error ? err.message : err);
  }
}

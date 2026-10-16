import "server-only";
import { requirePermission, type TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { AuditEntry, AuditPage } from "@/lib/live-types";
import { auditActionPrefixes, auditArea, auditQuerySchema, auditSummary } from "./clinic-admin-rules";
import { pageArgs, runScoped } from "./scope";

// The clinic's audit log (audit_events), newest first. RLS limits rows to the
// caller's clinic and to clinic.settings.manage / role.manage. Rows hold who,
// what and when — changed column names, never values — so nothing clinical is
// shown here.

export const AUDIT_VIEW = ["clinic.settings.manage", "role.manage"] as const;

const OUTCOME = { success: "SUCCESS", denied: "DENIED", failure: "FAILURE" } as const;

function systemLabel(label: string | null): string {
  if (!label) return "Former user";
  if (label.startsWith("db:") || label.startsWith("cli:")) return "System";
  return "Unknown user"; // e.g. the attempted email of a failed sign-in — not shown
}

export async function listAuditEvents(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<AuditPage> {
  requirePermission(ctx, AUDIT_VIEW);
  const input = auditQuerySchema.parse(raw ?? {});
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize ?? 25, 100);
  return runScoped(ctx, db, async (tx) => {
    const search = input.search?.trim();
    const actorIds = search
      ? (await tx.user.findMany({ where: { name: { contains: search, mode: "insensitive" } }, select: { id: true }, take: 200 })).map((u) => u.id)
      : [];
    const where = {
      clinicId: ctx.clinicId,
      ...(input.outcome ? { outcome: OUTCOME[input.outcome] } : {}),
      AND: [
        ...(input.area ? [{ OR: auditActionPrefixes(input.area).map((p) => ({ action: { startsWith: p } })) }] : []),
        ...(search ? [{ OR: [{ action: { contains: search.replace(/\s+/g, "_").toLowerCase() } }, ...(actorIds.length ? [{ actorUserId: { in: actorIds } }] : [])] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      tx.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: { id: true, occurredAt: true, actorUserId: true, actorLabel: true, action: true, outcome: true, reason: true, metadata: true },
      }),
      tx.auditEvent.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
    const names = new Map((ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
    const items: AuditEntry[] = rows.map((r) => {
      const meta = (r.metadata ?? {}) as { changed?: unknown };
      const changed = Array.isArray(meta.changed) ? meta.changed.filter((c): c is string => typeof c === "string") : [];
      return {
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actorName: (r.actorUserId && names.get(r.actorUserId)) || systemLabel(r.actorUserId ? null : r.actorLabel),
        summary: auditSummary(r.action, r.outcome, changed),
        action: r.action,
        area: auditArea(r.action),
        outcome: r.outcome.toLowerCase() as AuditEntry["outcome"],
        changed,
        reason: r.reason,
      };
    });
    return { items, total, page, pageSize };
  });
}

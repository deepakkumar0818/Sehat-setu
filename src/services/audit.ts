import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { DEMO_NOW } from "@/lib/demo-clock";
import { getDb, mutateDb } from "@/store/data-store";
import type { AuditLogEntry, AuthUser, UserRole } from "@/types";

export interface ListAuditLogParams {
  search?: string;
  actorRole?: UserRole | "all";
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listAuditLog(params: ListAuditLogParams = {}): Promise<PagedResult<AuditLogEntry>> {
  await delay();
  const { search = "", actorRole = "all", branchId = "all", page = 1, pageSize = 20 } = params;
  const items = getDb()
    .auditLog.filter((entry) => {
      if (actorRole !== "all" && entry.actorRole !== actorRole) return false;
      if (branchId !== "all" && entry.branchId !== branchId) return false;
      return matchesSearch([entry.actorName, entry.action, entry.entityType], search);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export interface LogAuditInput {
  actor: Pick<AuthUser, "name" | "role">;
  action: string;
  entityType: string;
  entityId?: string;
  branchId?: string;
}

/** Appends a new audit log entry, timestamped on the demo clock so it always sorts as "now". */
export function logAudit(input: LogAuditInput): void {
  const entry: AuditLogEntry = {
    id: padId("AUD", getDb().auditLog.length + 1, 5),
    actorName: input.actor.name,
    actorRole: input.actor.role,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    date: DEMO_NOW.toISOString(),
    branchId: input.branchId,
  };
  mutateDb((d) => ({ ...d, auditLog: [entry, ...d.auditLog] }));
}

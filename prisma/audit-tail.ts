// Read-only view of the most recent audit events (as postgres, so across all
// clinics — an operator tool, not an app feature).
//
//   npm run db:audit            # last 20 events
//   npm run db:audit -- 50      # last 50
import { createScriptClient } from "./seed/connect";

async function main() {
  const limit = Math.min(Math.max(Number(process.argv[2]) || 20, 1), 500);
  const prisma = createScriptClient();
  try {
    const rows = await prisma.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: limit });
    console.table(
      rows.map((e) => ({
        at: e.occurredAt.toISOString().replace("T", " ").slice(0, 19),
        action: e.action,
        outcome: e.outcome,
        actor: e.actorUserId ?? e.actorLabel ?? e.actorAuthId ?? "—",
        target: e.targetId ? `${e.targetType ?? ""}:${e.targetId}`.slice(0, 48) : "",
        reason: e.reason ?? "",
        ip: e.ipAddress ?? "",
        metadata: e.metadata ? JSON.stringify(e.metadata).slice(0, 60) : "",
      }))
    );
    const byAction = await prisma.auditEvent.groupBy({ by: ["action", "outcome"], _count: { _all: true }, orderBy: { action: "asc" } });
    console.table(byAction.map((g) => ({ action: g.action, outcome: g.outcome, count: g._count._all })));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

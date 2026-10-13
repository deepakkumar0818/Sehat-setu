import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/server/auth/errors";
import type { TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { LiveNotification, NotificationPage, UnreadCount } from "@/lib/live-types";
import { featureUnavailable, isMissingP5Schema } from "./invitation-rules";
import { renderNotification } from "./notification-templates";
import { runScoped } from "./scope";

// The signed-in staff member's notifications (migration 20261019000000_notifications).
//
// Rows are created only by database triggers; RLS (notifications_read) decides
// visibility: personal ones to their recipient, branch ones to holders of the
// required permission within their branch scope, never to patients or other
// clinics. Queries here also filter by clinic and the 90-day retention window.
// The only write is the reader's own read receipt (readAt is set by the database).

export const RETENTION_DAYS = 90;
export const UNREAD_CAP = 99;
const MAX_LIMIT = 50;

/** Cursor = the last row's exact database timestamp (microseconds) + id, opaque to clients. */
const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !z.string().uuid().safeParse(id).success) throw new DataError("INVALID_INPUT", "Invalid page cursor.");
  return { createdAt, id };
}

export const listNotificationsSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().optional(),
  unread: z.enum(["true", "false"]).optional(),
});

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingP5Schema(err)) throw featureUnavailable("Notifications");
    throw err;
  }
}

const retention = Prisma.sql`n."createdAt" > now() - make_interval(days => ${RETENTION_DAYS})`;

export async function listNotifications(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<NotificationPage> {
  const input = listNotificationsSchema.parse(raw);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_LIMIT);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  return guarded(() =>
    runScoped(ctx, db, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; type: string; refId: string | null; branchId: string | null; data: unknown; createdAt: Date; createdAtRaw: string; read: boolean }[]>`
        SELECT n.id, n.type::text AS type, n."refId", n."branchId", n.data, n."createdAt", n."createdAt"::text AS "createdAtRaw",
               (r."notificationId" IS NOT NULL) AS read
        FROM notifications n
        LEFT JOIN notification_reads r ON r."notificationId" = n.id AND r."userId" = ${ctx.userId}::uuid
        WHERE n."clinicId" = ${ctx.clinicId}::uuid AND ${retention}
          ${input.unread === "true" ? Prisma.sql`AND r."notificationId" IS NULL` : Prisma.empty}
          ${cursor ? Prisma.sql`AND (n."createdAt", n.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY n."createdAt" DESC, n.id DESC
        LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      const branchIds = new Set<string>();
      for (const r of page) {
        if (r.branchId) branchIds.add(r.branchId);
        const b = (r.data as { branchId?: unknown } | null)?.branchId;
        if (typeof b === "string" && z.string().uuid().safeParse(b).success) branchIds.add(b);
      }
      const branches = branchIds.size
        ? await tx.branch.findMany({ where: { clinicId: ctx.clinicId, id: { in: [...branchIds] } }, select: { id: true, name: true } })
        : [];
      const names = new Map(branches.map((b) => [b.id, b.name]));
      const items: LiveNotification[] = [];
      for (const r of page) {
        const text = renderNotification(r, (id) => (id ? names.get(id) ?? null : null));
        if (text) items.push({ id: r.id, ...text, createdAt: r.createdAt.toISOString(), read: r.read });
      }
      const last = page[page.length - 1];
      return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
    })
  );
}

export async function unreadCount(ctx: TenantContext, db?: TenantTx): Promise<UnreadCount> {
  return guarded(() =>
    runScoped(ctx, db, async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT 1 FROM notifications n
          WHERE n."clinicId" = ${ctx.clinicId}::uuid AND ${retention}
            AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r."notificationId" = n.id AND r."userId" = ${ctx.userId}::uuid)
          LIMIT ${UNREAD_CAP + 1}
        ) s`;
      return { count: Math.min(n, UNREAD_CAP), capped: n > UNREAD_CAP };
    })
  );
}

/** Marks one visible notification read for the signed-in user (idempotent). */
export async function markNotificationRead(ctx: TenantContext, id: string, db?: TenantTx): Promise<{ read: true }> {
  if (!z.string().uuid().safeParse(id).success) throw new AuthError("NOT_FOUND");
  return guarded(() =>
    runScoped(ctx, db, async (tx) => {
      const visible = await tx.$queryRaw<{ id: string }[]>`
        SELECT n.id FROM notifications n WHERE n.id = ${id}::uuid AND n."clinicId" = ${ctx.clinicId}::uuid AND ${retention}`;
      if (!visible.length) throw new AuthError("NOT_FOUND");
      // RLS (notification_reads_insert) re-checks: own user id, and a notification this user can see.
      await tx.$executeRaw`
        INSERT INTO notification_reads ("userId", "notificationId") VALUES (${ctx.userId}::uuid, ${id}::uuid)
        ON CONFLICT DO NOTHING`;
      return { read: true as const };
    })
  );
}

export const markAllSchema = z.object({ before: z.string().datetime({ offset: true }) }).strict();

/**
 * Marks every visible notification created at or before `before` as read, so
 * anything newer stays unread. Clients send the createdAt of the newest
 * notification they have shown (a database timestamp, so browser clock skew
 * doesn't matter); it's compared at the millisecond precision the API returns.
 */
export async function markAllNotificationsRead(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<{ marked: number }> {
  const { before } = markAllSchema.parse(raw);
  const cutoff = new Date(before);
  return guarded(() =>
    runScoped(ctx, db, async (tx) => {
      const marked = await tx.$executeRaw`
        INSERT INTO notification_reads ("userId", "notificationId")
        SELECT ${ctx.userId}::uuid, n.id FROM notifications n
        WHERE n."clinicId" = ${ctx.clinicId}::uuid AND ${retention} AND date_trunc('milliseconds', n."createdAt") <= ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r."notificationId" = n.id AND r."userId" = ${ctx.userId}::uuid)
        ON CONFLICT DO NOTHING`;
      return { marked };
    })
  );
}

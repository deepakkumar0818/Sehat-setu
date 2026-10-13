import { delay, paginate, type PagedResult } from "@/lib/async";
import { getDb, mutateDb } from "@/store/data-store";
import type { AppNotification, UserRole } from "@/types";

export interface ListNotificationsParams {
  role?: UserRole;
  patientId?: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

function scopedNotifications(role?: UserRole, patientId?: string): AppNotification[] {
  return getDb().notifications.filter((n) => {
    if (patientId) return n.patientId === patientId || (!n.patientId && !n.audienceRole);
    if (role) return !n.audienceRole || n.audienceRole === role || role === "clinic_admin" || role === "super_admin";
    return true;
  });
}

export async function listNotifications(params: ListNotificationsParams = {}): Promise<PagedResult<AppNotification>> {
  await delay(300);
  const { role, patientId, unreadOnly = false, page = 1, pageSize = 20 } = params;
  const items = scopedNotifications(role, patientId)
    .filter((n) => !unreadOnly || !n.read)
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function getUnreadCount(role?: UserRole, patientId?: string): Promise<number> {
  await delay(150);
  return scopedNotifications(role, patientId).filter((n) => !n.read).length;
}

export async function markNotificationRead(id: string): Promise<void> {
  await delay(150);
  mutateDb((d) => ({ ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
}

export async function markAllNotificationsRead(role?: UserRole, patientId?: string): Promise<void> {
  await delay(250);
  const scopedIds = new Set(scopedNotifications(role, patientId).map((n) => n.id));
  mutateDb((d) => ({
    ...d,
    notifications: d.notifications.map((n) => (scopedIds.has(n.id) ? { ...n, read: true } : n)),
  }));
}

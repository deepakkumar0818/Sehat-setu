import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate, optionalContextFor, present } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from "./notifications";
import { createAppointment, getAvailableSlots, rescheduleAppointment, transitionAppointment } from "./appointments";
import type { TenantTx } from "@/server/db/tenant";
import { adjustStock, receiveStock, setReorderLevel } from "./inventory";

// Notifications against the live database (migration 20261019000000). Skipped
// until it's applied. Notifications are produced by the real workflows (check-in,
// reschedule, stock movements) inside transactions that are rolled back, so
// none persist; counts/checksums are compared afterwards.

const probe = adminClient();
await probe.connect();
const APPLIED = Boolean((await probe.query(`SELECT to_regclass('public.notifications') IS NOT NULL AS ok`)).rows[0].ok);
await probe.end();

let admin: Client;
let adminA: TenantContext, adminB: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, nurseKothrud: TenantContext | undefined, doctor1: TenantContext, portalAsStaff: TenantContext;
let fingerprint = "";
let patient: { id: string; name: string };
const REASON = "ZZTEST private visit reason";
/** Two bookable IST days (no Sundays) for the fresh appointment and its reschedule. */
const days = [3, 4, 5, 6, 7].map(istDate).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);

/**
 * Books a fresh appointment with DR-01 at Wakad as the Wakad receptionist, inside
 * the caller's rolled-back transaction (so tests never depend on seed state).
 */
async function bookFresh(tx: TenantTx, as: (c: TenantContext) => Promise<void>) {
  await as(receptionWakad);
  for (const date of days) {
    const [time] = await getAvailableSlots(receptionWakad, FIX.doctor1, date, tx);
    if (!time) continue;
    const a = await createAppointment(receptionWakad, { patientId: patient.id, doctorId: FIX.doctor1, branchId: FIX.wakad, date, time, type: "in_person", reason: REASON }, tx);
    return { id: a.id, date };
  }
  throw new Error("no free slot for DR-01 at Wakad in the next week");
}

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
const snapshot = async () =>
  (await admin.query(`SELECT (SELECT count(*) FROM notifications) || '/' || (SELECT count(*) FROM notification_reads) || '/' || (SELECT count(*) FROM audit_events) || '/' ||
                             (SELECT md5(coalesce(string_agg(md5(a::text), '' ORDER BY md5(a::text)), '')) FROM appointments a) AS s`)).rows[0].s as string;

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  adminB = await contextFor(admin, "ST-07");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  doctor1 = await contextFor(admin, "DR-01");
  // A patient-portal user forcing a staff-shaped context: RLS must still show nothing.
  portalAsStaff = { ...adminA, userId: (await admin.query(`SELECT "userId" FROM patients WHERE "userId" IS NOT NULL LIMIT 1`)).rows[0].userId, roles: ["PATIENT"] };
  patient = (await admin.query(`SELECT id, name FROM patients WHERE "clinicId" = $1 AND "branchId" = $2 ORDER BY "patientNumber" LIMIT 1`, [FIX.clinicA, FIX.wakad])).rows[0];
  if (APPLIED) fingerprint = await snapshot();
});

afterAll(async () => {
  if (APPLIED) expect(await snapshot()).toBe(fingerprint);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe.skipIf(!APPLIED)("notifications (live database, rolled back)", () => {
  it("check-in notifies only the assigned doctor, with no patient or clinical details", async () => {
    await inRollback(async ({ tx, as }) => {
      const appt = await bookFresh(tx, as);
      await transitionAppointment(receptionWakad, appt.id, "check-in", tx);

      await as(doctor1);
      const mine = await listNotifications(doctor1, {}, tx);
      const n = mine.items.find((x) => x.type === "appointment_checked_in");
      expect(n).toMatchObject({ title: "Patient checked in", read: false, link: "/waiting-room" });
      expect(`${n?.title} ${n?.body}`).not.toContain(patient.name);
      expect(`${n?.title} ${n?.body}`).not.toContain(REASON);
      // Booking also notified the doctor, equally without the patient or the reason.
      const booked = mine.items.find((x) => x.type === "appointment_booked");
      expect(booked).toBeDefined();
      expect(`${booked?.title} ${booked?.body}`).not.toMatch(new RegExp(`${patient.name}|${REASON}`));
      expect((await unreadCount(doctor1, tx)).count).toBeGreaterThanOrEqual(1);

      for (const ctx of present(receptionWakad, nurseKothrud, adminB, portalAsStaff)) {
        await as(ctx);
        const theirs = await listNotifications(ctx, {}, tx);
        expect(theirs.items.some((x) => x.id === n!.id), ctx.name).toBe(false);
        expect(await code(markNotificationRead(ctx, n!.id, tx)), ctx.name).toBe("NOT_FOUND");
      }
    });
  });

  it("mark one read (idempotent) and mark all read up to a cutoff", async () => {
    await inRollback(async ({ tx, as }) => {
      const appt = await bookFresh(tx, as);
      await transitionAppointment(receptionWakad, appt.id, "check-in", tx);
      await as(doctor1);
      const [first] = (await listNotifications(doctor1, { unread: "true" }, tx)).items;
      expect(await markNotificationRead(doctor1, first.id, tx)).toEqual({ read: true });
      expect(await markNotificationRead(doctor1, first.id, tx)).toEqual({ read: true });
      expect((await listNotifications(doctor1, {}, tx)).items.find((x) => x.id === first.id)?.read).toBe(true);
      // A cutoff before these notifications existed marks nothing; "now" marks the rest.
      expect((await markAllNotificationsRead(doctor1, { before: "2000-01-01T00:00:00.000Z" }, tx)).marked).toBe(0);
      const newest = (await listNotifications(doctor1, {}, tx)).items[0].createdAt; // a server timestamp, as the UI sends
      await markAllNotificationsRead(doctor1, { before: newest }, tx);
      expect((await unreadCount(doctor1, tx)).count).toBe(0);
    });
  });

  it("rescheduling notifies the doctor; a doctor's own change doesn't notify themselves", async () => {
    await inRollback(async ({ tx, as }) => {
      const appt = await bookFresh(tx, as);
      const day = days.find((d) => d !== appt.date)!;
      await as(adminA);
      const [t1, t2] = await getAvailableSlots(adminA, FIX.doctor1, day, tx);
      await rescheduleAppointment(adminA, appt.id, { date: day, time: t1 }, tx);
      await as(doctor1);
      expect((await listNotifications(doctor1, {}, tx)).items.some((x) => x.type === "appointment_rescheduled")).toBe(true);
      const before = (await unreadCount(doctor1, tx)).count;
      await rescheduleAppointment(doctor1, appt.id, { date: day, time: t2 }, tx);
      expect((await unreadCount(doctor1, tx)).count).toBe(before);
    });
  });

  it("stock crossing its reorder level alerts inventory viewers of that branch only", async () => {
    const medicineId = (await admin.query(
      `SELECT m.id FROM medicines m WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i."medicineId" = m.id AND i."branchId" = $1) ORDER BY m.name LIMIT 1`,
      [FIX.wakad]
    )).rows[0].id as string;
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const received = await receiveStock(adminA, { branchId: FIX.wakad, medicineId, batchNumber: "ZZTEST-N1", expiryDate: istDate(200), quantity: 10 }, tx);
      await setReorderLevel(adminA, FIX.wakad, medicineId, { reorderLevel: 5 }, tx);
      const batch = received.batches[0];
      await adjustStock(adminA, batch.id, { quantityDelta: -6, reason: "ZZTEST count" }, tx); // 10 → 4 (≤ 5): low
      await adjustStock(adminA, batch.id, { quantityDelta: -4, reason: "ZZTEST count" }, tx); // 4 → 0: out

      await as(managerWakad);
      const types = (await listNotifications(managerWakad, {}, tx)).items.map((x) => x.type);
      expect(types).toEqual(expect.arrayContaining(["stock_low", "stock_out"]));
      const low = (await listNotifications(managerWakad, {}, tx)).items.find((x) => x.type === "stock_low");
      expect(low?.link).toBe(`/inventory/${FIX.wakad}/${medicineId}`);
      for (const ctx of present(receptionWakad, nurseKothrud, doctor1, adminB)) {
        await as(ctx);
        expect((await listNotifications(ctx, {}, tx)).items.some((x) => x.type === "stock_low" || x.type === "stock_out"), ctx.name).toBe(false);
      }
    });
  });

  it("pages with an opaque cursor and rejects forged ones", async () => {
    await inRollback(async ({ tx, as }) => {
      const appt = await bookFresh(tx, as); // "booked" notification
      await transitionAppointment(receptionWakad, appt.id, "check-in", tx); // "checked in" notification
      await as(doctor1);
      const p1 = await listNotifications(doctor1, { limit: "1" }, tx);
      expect(p1.items).toHaveLength(1);
      expect(p1.nextCursor).toBeTruthy();
      const p2 = await listNotifications(doctor1, { limit: "1", cursor: p1.nextCursor! }, tx);
      expect(p2.items[0]?.id).not.toBe(p1.items[0].id);
      expect(await code(listNotifications(doctor1, { cursor: "not-a-cursor" }, tx))).toBe("INVALID_INPUT");
    });
  });
});

describe.runIf(!APPLIED)("before the notifications migration is applied", () => {
  it("reports 'not set up' instead of failing obscurely", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await code(listNotifications(adminA, {}, tx))).toBe("FEATURE_UNAVAILABLE");
    });
  });
});

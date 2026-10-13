import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, istDate } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import { createManualInvoice, getBillingSummary, recordPayment, refundPayment, voidInvoice } from "./billing";
import { exportReport, getFinancialReport, getOperationalReport } from "./reports";

// Clinic reports against the live database, as real (fictional) fixture users.
// Every figure is compared with an independent query on the admin connection
// (which bypasses RLS and shares no code with reports.ts). Writes (invoices,
// payments, refunds, export audit events) happen only inside transactions
// that are rolled back; table counts are compared afterwards.

let admin: Client;
let adminA: TenantContext; // Aarogya administrator: reports.view + reports.export + billing.manage + medical_record.view
let adminB: TenantContext; // Nirmaya administrator
let managerWakad: TenantContext; // Aarogya clinic manager, Wakad only: reports.view + billing.view, no export
let receptionWakad: TenantContext; // no reports.view
let doctor1: TenantContext; // no reports.view; own appointments only
let counts: Record<string, number>;

const RANGE = { from: istDate(-60), to: istDate(30) };
const EMPTY = { from: "2001-01-01", to: "2001-01-31" };

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  invoices: await n(`SELECT count(*) n FROM invoices`),
  payments: await n(`SELECT count(*) n FROM payments`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  patients: await n(`SELECT count(*) n FROM patients`),
  appointments: await n(`SELECT count(*) n FROM appointments`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);

// Independent IST range bounds, computed by PostgreSQL itself.
const IN_RANGE = (col: string) => `${col} >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${col} < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;

async function apptTruth(clinicId: string, extra = "", params: unknown[] = []) {
  const rows = (await admin.query(`SELECT status::text, count(*)::int n FROM appointments WHERE "clinicId" = $1 AND ${IN_RANGE('"startsAt"')} ${extra} GROUP BY 1`, [clinicId, RANGE.from, RANGE.to, ...params])).rows as { status: string; n: number }[];
  const by = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.n, 0);
  return { total: by("SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW"), completed: by("COMPLETED"), upcoming: by("SCHEDULED", "CONFIRMED"), inProgress: by("CHECKED_IN", "IN_CONSULTATION"), cancelled: by("CANCELLED"), noShow: by("NO_SHOW") };
}

const paymentTruth = (clinicId: string, status: string, extra = "", params: unknown[] = []) =>
  n(`SELECT coalesce(sum(p."amountPaise"), 0) n FROM payments p JOIN invoices i ON i.id = p."invoiceId" WHERE p."clinicId" = $1 AND p.status = '${status}' AND ${IN_RANGE('p."paidAt"')} ${extra}`, [clinicId, RANGE.from, RANGE.to, ...params]);

const outstandingTruth = (clinicId: string, extra = "", params: unknown[] = []) =>
  n(`SELECT coalesce(sum(greatest(0, i."totalPaise" - coalesce((SELECT sum("amountPaise") FROM payments WHERE "invoiceId" = i.id AND status = 'SUCCEEDED'), 0))), 0) n
     FROM invoices i WHERE i."clinicId" = $1 AND i.status IN ('PENDING', 'PARTIALLY_PAID') ${extra}`, [clinicId, ...params]);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-02", "ST-04", "DR-01"]) ctxs.push(await contextFor(admin, k)); // one pg client: sequential
  [adminA, adminB, managerWakad, receptionWakad, doctor1] = ctxs;
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("operational report", () => {
  it("counts appointments by status, day, month, branch and doctor exactly as the database does", async () => {
    const r = await getOperationalReport(adminA, RANGE);
    const truth = await apptTruth(FIX.clinicA);
    expect(truth.total).toBeGreaterThan(0); // the fixture range really has data
    expect(r.appointments!.totals).toEqual(truth);
    // Every breakdown adds up to the same totals (each appointment counted once).
    const sum = (rows: { total: number }[]) => rows.reduce((t, x) => t + x.total, 0);
    expect(sum(r.appointments!.daily)).toBe(truth.total);
    expect(sum(r.appointments!.monthly)).toBe(truth.total);
    expect(sum(r.appointments!.byBranch)).toBe(truth.total);
    expect(sum(r.workload!.doctors)).toBe(truth.total);
    expect(r.appointments!.daily.map((d) => d.date)).toHaveLength(91); // every day, including empty ones
    expect(r.appointments!.byBranch.find((b) => b.branchId === FIX.wakad)).toMatchObject(await apptTruth(FIX.clinicA, `AND "branchId" = $4`, [FIX.wakad]));
    const dr1 = r.workload!.doctors.find((d) => d.doctorId === FIX.doctor1)!;
    expect(dr1).toMatchObject(await apptTruth(FIX.clinicA, `AND "doctorId" = $4`, [FIX.doctor1]));
    expect(dr1.noShowRate).toBe(dr1.completed + dr1.noShow ? dr1.noShow / (dr1.completed + dr1.noShow) : null);
    expect(dr1.doctorName).toMatch(/\S/);
    expect(r.scope).toMatchObject({ from: RANGE.from, to: RANGE.to, branchId: null, branchLocked: false, ownAppointmentsOnly: false, canViewFinancial: true, canExport: true });
  });

  it("counts appointments on IST calendar days (a 23:59 IST booking is that day, not the next UTC day)", async () => {
    const day = (await admin.query(`SELECT to_char(("startsAt" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') d, count(*)::int n FROM appointments WHERE "clinicId" = $1 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1`, [FIX.clinicA])).rows[0] as { d: string; n: number };
    const r = await getOperationalReport(adminA, { from: day.d, to: day.d });
    expect(r.appointments!.totals.total).toBe(day.n);
    expect(r.appointments!.daily).toEqual([expect.objectContaining({ date: day.d, total: day.n })]);
  });

  it("counts new patients by the day their record was created, without any patient details", async () => {
    const r = await getOperationalReport(adminA, RANGE);
    const truth = await n(`SELECT count(*) n FROM patients WHERE "clinicId" = $1 AND ${IN_RANGE('"createdAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]);
    expect(r.patients!.total).toBe(truth);
    expect(r.patients!.daily.reduce((t, d) => t + d.count, 0)).toBe(truth);
    expect(r.patients!.byBranch.reduce((t, b) => t + b.count, 0)).toBe(truth);
    // Aggregates only: no patient names, numbers or phone numbers anywhere in the response.
    const sample = (await admin.query(`SELECT name, "patientNumber", phone FROM patients WHERE "clinicId" = $1 LIMIT 5`, [FIX.clinicA])).rows;
    const json = JSON.stringify(r);
    for (const p of sample) for (const v of [p.name, p.patientNumber, p.phone]) expect(json).not.toContain(v);
  });

  it("reports consultation length only from consistent timestamps — never guessed", async () => {
    const r = await getOperationalReport(adminA, RANGE);
    const completed = await n(
      `SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE c."clinicId" = $1 AND c.status = 'COMPLETED' AND c."completedAt" IS NOT NULL AND ${IN_RANGE('a."startsAt"')}`,
      [FIX.clinicA, RANGE.from, RANGE.to]
    );
    const reliable = await n(
      `SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE c."clinicId" = $1 AND c.status = 'COMPLETED' AND c."completedAt" IS NOT NULL AND ${IN_RANGE('a."startsAt"')}
         AND c."completedAt" > c."createdAt" AND c."completedAt" - c."createdAt" <= interval '4 hours' AND c."createdAt" >= a."startsAt" - interval '2 hours' AND c."createdAt" < a."startsAt" + interval '1 day'`,
      [FIX.clinicA, RANGE.from, RANGE.to]
    );
    const d = r.workload!.duration;
    if (reliable === 0) expect(d).toEqual({ available: false, reason: "no_reliable_timestamps", excluded: completed });
    else expect(d).toMatchObject({ available: true, samples: reliable, excluded: completed - reliable });
    // Clinic managers can't read consultations (RLS), so the length is "not permitted", not 0.
    const m = await getOperationalReport(managerWakad, RANGE);
    expect(m.workload!.duration).toEqual({ available: false, reason: "not_permitted", excluded: 0 });
    expect(m.workload!.doctors.every((x) => x.avgConsultationMinutes === null)).toBe(true);
  });

  it("returns an empty period as real zeros, with every day present", async () => {
    const r = await getOperationalReport(adminA, EMPTY);
    expect(r.appointments!.totals).toEqual({ total: 0, completed: 0, upcoming: 0, inProgress: 0, cancelled: 0, noShow: 0 });
    expect(r.appointments!.daily).toHaveLength(31);
    expect(r.appointments!.byBranch).toEqual([]);
    expect(r.patients!.total).toBe(0);
    expect(r.workload!.doctors).toEqual([]);
    expect(r.workload!.duration).toMatchObject({ available: false, reason: "no_reliable_timestamps", excluded: 0 });
  });
});

describe("financial report", () => {
  it("collected = SUCCEEDED payments by payment date; refunds separate; billed and outstanding never mixed with revenue", async () => {
    const f = await getFinancialReport(adminA, RANGE);
    const net = await paymentTruth(FIX.clinicA, "SUCCEEDED");
    const refunded = await paymentTruth(FIX.clinicA, "REFUNDED");
    expect(net).toBeGreaterThan(0);
    expect(f.collections).toMatchObject({ netPaise: net, refundedPaise: refunded, grossPaise: net + refunded });
    expect(f.collections.paymentCount).toBe(await n(`SELECT count(*) n FROM payments p WHERE p."clinicId" = $1 AND p.status = 'SUCCEEDED' AND ${IN_RANGE('p."paidAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]));
    // Each breakdown re-adds to the same net amount (no payment counted twice).
    expect(f.collections.daily.reduce((t, d) => t + d.netPaise, 0)).toBe(net);
    expect(f.collections.byMethod.reduce((t, m) => t + m.netPaise, 0)).toBe(net);
    expect(f.collections.byBranch.reduce((t, b) => t + b.netPaise, 0)).toBe(net);
    expect(f.collections.byMethod.find((m) => m.method === "cash")!.netPaise).toBe(await paymentTruth(FIX.clinicA, "SUCCEEDED", `AND p.method = 'CASH'`));
    // FAILED and PENDING payments are not money received.
    expect(f.collections.byMethod.find((m) => m.method === "online")!.netPaise).toBe(await paymentTruth(FIX.clinicA, "SUCCEEDED", `AND p.method = 'ONLINE'`));
    expect(f.billed.invoicedPaise).toBe(await n(`SELECT coalesce(sum("totalPaise"), 0) n FROM invoices WHERE "clinicId" = $1 AND status <> 'VOID' AND ${IN_RANGE('"issuedAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to]));
    // Outstanding matches an independent query AND the existing billing summary.
    const owed = await outstandingTruth(FIX.clinicA);
    expect(f.outstanding.totalPaise).toBe(owed);
    expect(Math.round((await getBillingSummary(adminA)).outstandingBalance * 100)).toBe(owed);
    expect(f.outstanding.bands.map((b) => b.band)).toEqual(["current", "d1_30", "d31_60", "d61_90", "d90_plus"]);
  });

  it("ages each open balance by its due date (or issue date) in IST", async () => {
    const f = await getFinancialReport(adminA, RANGE);
    const rows = (await admin.query(
      `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - coalesce(i."dueDate", (i."issuedAt" AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,
              greatest(0, i."totalPaise" - coalesce((SELECT sum("amountPaise") FROM payments WHERE "invoiceId" = i.id AND status = 'SUCCEEDED'), 0)) AS bal
       FROM invoices i WHERE i."clinicId" = $1 AND i.status IN ('PENDING', 'PARTIALLY_PAID')`, [FIX.clinicA])).rows as { overdue: number; bal: string }[];
    const band = (lo: number, hi: number) => rows.filter((r) => Number(r.bal) > 0 && r.overdue >= lo && r.overdue <= hi).reduce((t, r) => t + Number(r.bal), 0);
    expect(f.outstanding.bands.map((b) => b.balancePaise)).toEqual([band(-1e6, 0), band(1, 30), band(31, 60), band(61, 90), band(91, 1e6)]);
  });

  it("partial payments, refunds and voids move the figures exactly as the rules say", async () => {
    const patientId = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "branchId" = $2 AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 1`, [FIX.clinicA, FIX.wakad])).rows[0].id;
    const today = istDate(0);
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const before = await getFinancialReport(adminA, { from: today, to: today }, tx);
      const inv = await createManualInvoice(adminA, { patientId, branchId: FIX.wakad, items: [{ description: "ZZTEST report item", category: "other", quantity: 1, unitPricePaise: 100_000 }] }, tx);
      const afterInvoice = await getFinancialReport(adminA, { from: today, to: today }, tx);
      // Billing an invoice is not revenue.
      expect(afterInvoice.collections.netPaise).toBe(before.collections.netPaise);
      expect(afterInvoice.billed.invoicedPaise).toBe(before.billed.invoicedPaise + 100_000);
      expect(afterInvoice.outstanding.totalPaise).toBe(before.outstanding.totalPaise + 100_000);

      const paid = await recordPayment(adminA, inv.id, { amountPaise: 40_000, method: "upi" }, tx);
      const payment = paid.payments!.at(-1)!;
      const afterPartial = await getFinancialReport(adminA, { from: today, to: today }, tx);
      expect(afterPartial.collections.netPaise).toBe(before.collections.netPaise + 40_000);
      expect(afterPartial.collections.byMethod.find((m) => m.method === "upi")!.netPaise).toBe(before.collections.byMethod.find((m) => m.method === "upi")!.netPaise + 40_000);
      expect(afterPartial.outstanding.totalPaise).toBe(before.outstanding.totalPaise + 60_000);

      await refundPayment(adminA, payment.id, tx);
      const afterRefund = await getFinancialReport(adminA, { from: today, to: today }, tx);
      expect(afterRefund.collections.netPaise).toBe(before.collections.netPaise);
      expect(afterRefund.collections.refundedPaise).toBe(before.collections.refundedPaise + 40_000);
      expect(afterRefund.collections.grossPaise).toBe(before.collections.grossPaise + 40_000);
      expect(afterRefund.outstanding.totalPaise).toBe(before.outstanding.totalPaise + 100_000);

      await voidInvoice(adminA, inv.id, tx); // no received payments left, so it can be voided
      const afterVoid = await getFinancialReport(adminA, { from: today, to: today }, tx);
      expect(afterVoid.billed.invoicedPaise).toBe(before.billed.invoicedPaise);
      expect(afterVoid.billed.voidCount).toBe(before.billed.voidCount + 1);
      expect(afterVoid.billed.voidPaise).toBe(before.billed.voidPaise + 100_000);
      expect(afterVoid.outstanding.totalPaise).toBe(before.outstanding.totalPaise); // a void invoice owes nothing
      expect(afterVoid.collections.refundedPaise).toBe(before.collections.refundedPaise + 40_000); // the refund still happened
    });
  });

  it("returns an empty period as zeros; outstanding is as of today regardless of the range", async () => {
    const f = await getFinancialReport(adminA, EMPTY);
    expect(f.collections).toMatchObject({ netPaise: 0, refundedPaise: 0, grossPaise: 0, paymentCount: 0, refundCount: 0, byBranch: [] });
    expect(f.billed).toEqual({ invoicedPaise: 0, invoiceCount: 0, voidCount: 0, voidPaise: 0 });
    expect(f.outstanding.totalPaise).toBe(await outstandingTruth(FIX.clinicA));
  });
});

describe("isolation and permissions", () => {
  it("never crosses clinics: another clinic's administrator sees only their own figures and branches", async () => {
    const r = await getOperationalReport(adminB, RANGE);
    expect(r.appointments!.totals).toEqual(await apptTruth(FIX.clinicB));
    expect(r.scope.branches.map((b) => b.id)).not.toContain(FIX.wakad);
    expect(r.workload!.doctors.map((d) => d.doctorId)).not.toContain(FIX.doctor1);
    const f = await getFinancialReport(adminB, RANGE);
    expect(f.collections.netPaise).toBe(await paymentTruth(FIX.clinicB, "SUCCEEDED"));
    expect(f.outstanding.totalPaise).toBe(await outstandingTruth(FIX.clinicB));
    // Naming clinic A's branch is refused, not answered.
    expect(await code(getOperationalReport(adminB, { ...RANGE, branchId: FIX.wakad }))).toBe("INVALID_INPUT");
  });

  it("a branch-limited manager sees only their branch, and can't ask for another", async () => {
    const r = await getOperationalReport(managerWakad, RANGE);
    expect(r.scope).toMatchObject({ branchId: FIX.wakad, branchLocked: true, canExport: false, canViewFinancial: true });
    expect(r.scope.branches.map((b) => b.id)).toEqual([FIX.wakad]);
    expect(r.appointments!.totals).toEqual(await apptTruth(FIX.clinicA, `AND "branchId" = $4`, [FIX.wakad]));
    expect(r.patients!.total).toBe(await n(`SELECT count(*) n FROM patients WHERE "clinicId" = $1 AND "branchId" = $4 AND ${IN_RANGE('"createdAt"')}`, [FIX.clinicA, RANGE.from, RANGE.to, FIX.wakad]));
    const f = await getFinancialReport(managerWakad, RANGE);
    expect(f.collections.netPaise).toBe(await paymentTruth(FIX.clinicA, "SUCCEEDED", `AND i."branchId" = $4`, [FIX.wakad]));
    expect(f.outstanding.totalPaise).toBe(await outstandingTruth(FIX.clinicA, `AND i."branchId" = $2`, [FIX.wakad]));
    expect(await code(getOperationalReport(managerWakad, { ...RANGE, branchId: FIX.kothrud }))).toBe("BRANCH_FORBIDDEN");
    expect(await code(getFinancialReport(managerWakad, { ...RANGE, branchId: FIX.kothrud }))).toBe("BRANCH_FORBIDDEN");
  });

  it("a clinic-wide administrator can filter to one branch", async () => {
    const r = await getOperationalReport(adminA, { ...RANGE, branchId: FIX.kothrud });
    expect(r.scope.branchId).toBe(FIX.kothrud);
    expect(r.appointments!.totals).toEqual(await apptTruth(FIX.clinicA, `AND "branchId" = $4`, [FIX.kothrud]));
  });

  it("a doctor limited to their own appointments sees only their own workload — and RLS enforces it even if the app didn't", async () => {
    // No role combines reports.view with own-only appointments today; grant it to a context in memory only.
    const doctorReports: TenantContext = { ...doctor1, permissions: new Set([...doctor1.permissions, "reports.view"]) };
    const own = await apptTruth(FIX.clinicA, `AND "doctorId" = $4`, [FIX.doctor1]);
    const r = await getOperationalReport(doctorReports, RANGE);
    expect(r.scope.ownAppointmentsOnly).toBe(true);
    expect(r.appointments!.totals).toEqual(own);
    expect(r.workload!.doctors.map((d) => d.doctorId)).toEqual(own.total ? [FIX.doctor1] : []);
    expect(r.patients).toBeNull(); // no clinic-wide patient visibility
    expect(r.unavailable).toContainEqual({ section: "patients", reason: "not_permitted" });
    // A forged "clinic" scope changes nothing: RLS still returns only this doctor's appointments.
    const forged = await getOperationalReport({ ...doctorReports, careScope: "clinic" }, RANGE);
    expect(forged.appointments!.totals).toEqual(own);
    expect(await code(getFinancialReport(doctorReports, RANGE))).toBe("FORBIDDEN");
  });

  it("refuses users without reports.view, and financial figures without a billing permission", async () => {
    expect(await code(getOperationalReport(receptionWakad, RANGE))).toBe("FORBIDDEN");
    expect(await code(getFinancialReport(receptionWakad, RANGE))).toBe("FORBIDDEN");
    expect(await code(getOperationalReport(doctor1, RANGE))).toBe("FORBIDDEN");
    const noBilling: TenantContext = { ...managerWakad, permissions: new Set([...managerWakad.permissions].filter((p) => p !== "billing.view")) };
    expect(await code(getFinancialReport(noBilling, RANGE))).toBe("FORBIDDEN");
    expect((await getOperationalReport(noBilling, RANGE)).scope.canViewFinancial).toBe(false);
  });

  it("validates dates, ranges and branch ids", async () => {
    for (const bad of [{ from: "2026-10-10", to: "2026-10-01" }, { from: "2025-01-01", to: "2026-06-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "13/10/2026", to: "2026-10-13" }, { ...RANGE, branchId: "00000000-0000-4000-8000-000000000000" }]) {
      expect(await code(getOperationalReport(adminA, bad)), JSON.stringify(bad)).toBe("INVALID_INPUT");
    }
    expect(await code(getOperationalReport(adminA, { ...RANGE, branchId: "not-a-uuid" }))).toBe("ZodError");
    // Defaults: the last 30 days ending today (IST).
    const d = await getOperationalReport(adminA, {});
    expect(d.scope).toMatchObject({ from: istDate(-29), to: istDate(0) });
  });
});

describe("CSV export", () => {
  it("needs reports.export, applies the same scope, and audits without figures or patient details", async () => {
    expect(await code(exportReport(managerWakad, { report: "appointments", ...RANGE }))).toBe("FORBIDDEN");
    expect(await code(exportReport(receptionWakad, { report: "collections", ...RANGE }))).toBe("FORBIDDEN");
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const file = await exportReport(adminA, { report: "appointments", ...RANGE }, tx);
      expect(file.filename).toBe(`sehat-setu_appointments_${RANGE.from}_to_${RANGE.to}.csv`);
      const lines = file.csv.replace(/^\uFEFF/, "").trim().split("\r\n");
      expect(lines[0]).toBe("Date,Total,Completed,Upcoming,In progress,Cancelled,No-shows");
      expect(lines).toHaveLength(92);
      const truth = await apptTruth(FIX.clinicA);
      expect(lines.slice(1).reduce((t, l) => t + Number(l.split(",")[1]), 0)).toBe(truth.total);

      const money = await exportReport(adminA, { report: "collections", ...RANGE, branchId: FIX.wakad }, tx);
      const net = await paymentTruth(FIX.clinicA, "SUCCEEDED", `AND i."branchId" = $4`, [FIX.wakad]);
      const sumRupees = money.csv.replace(/^\uFEFF/, "").trim().split("\r\n").slice(1).reduce((t, l) => t + Math.round(Number(l.split(",")[1]) * 100), 0);
      expect(sumRupees).toBe(net);

      const workload = await exportReport(adminA, { report: "doctor_workload", ...RANGE }, tx);
      expect(workload.csv).toContain("No-show rate (%)");

      const events = await tx.auditEvent.findMany({ where: { action: "report.exported", actorUserId: adminA.userId }, orderBy: { occurredAt: "asc" }, select: { targetType: true, targetId: true, clinicId: true, metadata: true } });
      expect(events.slice(-3)).toEqual([
        { targetType: "report", targetId: "appointments", clinicId: FIX.clinicA, metadata: { from: RANGE.from, to: RANGE.to, branch: "all", rows: 91 } },
        { targetType: "report", targetId: "collections", clinicId: FIX.clinicA, metadata: { from: RANGE.from, to: RANGE.to, branch: FIX.wakad, rows: 91 } },
        { targetType: "report", targetId: "doctor_workload", clinicId: FIX.clinicA, metadata: expect.objectContaining({ from: RANGE.from, branch: "all" }) },
      ]);
    });
  });

  it("refuses an export whose section the user can't see, and unknown report names", async () => {
    // reports.export without appointment access: the appointments export is refused.
    const exporterNoAppts: TenantContext = { ...adminA, careScope: "none" };
    expect(await code(exportReport(exporterNoAppts, { report: "appointments", ...RANGE }))).toBe("FORBIDDEN");
    const exporterNoBilling: TenantContext = { ...adminA, permissions: new Set([...adminA.permissions].filter((p) => !["billing.manage", "billing.view"].includes(p))) };
    expect(await code(exportReport(exporterNoBilling, { report: "outstanding_ageing", ...RANGE }))).toBe("FORBIDDEN");
    expect(await code(exportReport(adminA, { report: "patients_with_names", ...RANGE }))).toBe("ZodError");
  });
});

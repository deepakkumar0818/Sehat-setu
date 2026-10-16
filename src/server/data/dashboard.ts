import "server-only";
import { withTenantDb, type TenantTx } from "@/server/db/tenant";
import { appointmentScopeFilter, hasAnyPermission, type TenantContext } from "@/server/auth/authorize";
import { istDayKey, istDayRange, istMonthStart, istTodayKey } from "@/lib/ist";

// Clinic dashboard data, read from PostgreSQL for one verified TenantContext.
// Every query (1) runs inside withTenantDb, so RLS scopes it to the caller's
// clinic, branch, and record-level rights, and (2) ALSO filters explicitly by
// clinic, branch, and — for doctors with only own_* permissions — doctor.
// Metrics are computed from stored rows; nothing is hard-coded.

export interface DashboardAppointment {
  id: string;
  /** yyyy-MM-dd and HH:mm in IST. */
  date: string;
  time: string;
  patientName: string;
  patientNumber: string | null;
  doctorName: string;
  branchName: string;
  type: string;
  status: string;
}

export interface DashboardData {
  clinicName: string;
  branchName: string | null;
  scope: "clinic" | "own";
  /** null when the user's role can't see patients. */
  totalPatients: number | null;
  activeDoctors: number;
  today: { total: number; waiting: number; completed: number; online: number };
  upcomingNext14Days: number;
  statusBreakdown: { status: string; count: number }[];
  todaysAppointments: DashboardAppointment[];
  recentAppointments: DashboardAppointment[];
  /** null when the user has no billing permission. Amounts in rupees. */
  billing: {
    todaysRevenue: number;
    monthRevenue: number;
    outstanding: number;
    invoiceCounts: { paid: number; partiallyPaid: number; pending: number };
    revenueTrend: { date: string; revenue: number }[];
  } | null;
}

const PATIENT_VIEW = ["patient.view", "patient.basic_info.view", "assigned_patients.view"];
const BILLING_VIEW = ["billing.view", "invoice.view", "billing.manage"];
// Pending and declined patient requests aren't appointments yet: excluded from every list and count here.
const STATUS_ORDER = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW"];
const NOT_REQUESTS = { notIn: ["PENDING_APPROVAL", "REJECTED"] as ("PENDING_APPROVAL" | "REJECTED")[] };

type ApptRow = { id: string; startsAt: Date; type: string; status: string; patientId: string; doctorId: string; branchId: string };

/** Resolves names separately so a record hidden by RLS degrades to "—" instead of failing the page. */
async function describeAppointments(tx: TenantTx, rows: ApptRow[]): Promise<DashboardAppointment[]> {
  if (rows.length === 0) return [];
  const [patients, doctors, branches] = await Promise.all([
    tx.patient.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } }, select: { id: true, name: true, patientNumber: true } }),
    tx.doctorProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.doctorId))] } }, select: { id: true, user: { select: { name: true } } } }),
    tx.branch.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.branchId))] } }, select: { id: true, name: true } }),
  ]);
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const doctorById = new Map(doctors.map((d) => [d.id, d.user.name]));
  const branchById = new Map(branches.map((b) => [b.id, b.name]));
  return rows.map((r) => {
    const key = istDayKey(r.startsAt);
    return {
      id: r.id,
      date: key.date,
      time: key.time,
      patientName: patientById.get(r.patientId)?.name ?? "—",
      patientNumber: patientById.get(r.patientId)?.patientNumber ?? null,
      doctorName: doctorById.get(r.doctorId) ?? "—",
      branchName: branchById.get(r.branchId) ?? "—",
      type: r.type.toLowerCase(),
      status: r.status.toLowerCase(),
    };
  });
}

export async function getDashboardData(ctx: TenantContext, now: Date = new Date()): Promise<DashboardData> {
  if (ctx.careScope === "none") throw new Error("getDashboardData requires appointment access"); // callers check careScope first
  const doctorFilter = appointmentScopeFilter(ctx);
  const own = ctx.careScope === "own";
  const branchFilter = ctx.branchId ? { branchId: ctx.branchId } : {};
  const apptScope = { clinicId: ctx.clinicId, ...branchFilter, ...doctorFilter };
  const today = istDayRange(now, 0);
  const windowStart = istDayRange(now, -30).start;
  const windowEnd = istDayRange(now, 14).end;
  const canSeePatients = hasAnyPermission(ctx, PATIENT_VIEW);
  const canSeeBilling = hasAnyPermission(ctx, BILLING_VIEW);
  const apptSelect = { id: true, startsAt: true, type: true, status: true, patientId: true, doctorId: true, branchId: true } as const;

  return withTenantDb(ctx, async (tx) => {
    const [branch, totalPatients, activeDoctors, todays, recent, upcomingNext14Days, statusGroups] = await Promise.all([
      ctx.branchId ? tx.branch.findFirst({ where: { id: ctx.branchId, clinicId: ctx.clinicId }, select: { name: true } }) : null,
      canSeePatients
        ? tx.patient.count({
            where: {
              clinicId: ctx.clinicId,
              status: { not: "ARCHIVED" },
              ...(own ? { appointments: { some: { doctorId: ctx.doctorId! } } } : {}),
            },
          })
        : null,
      tx.doctorProfile.count({
        where: { clinicId: ctx.clinicId, status: "ACTIVE", ...(ctx.branchId ? { branches: { some: { branchId: ctx.branchId } } } : {}) },
      }),
      tx.appointment.findMany({ where: { ...apptScope, startsAt: { gte: today.start, lt: today.end }, status: NOT_REQUESTS }, orderBy: { startsAt: "asc" }, select: apptSelect }),
      tx.appointment.findMany({ where: { ...apptScope, startsAt: { lt: today.start }, status: NOT_REQUESTS }, orderBy: { startsAt: "desc" }, take: 8, select: apptSelect }),
      tx.appointment.count({ where: { ...apptScope, startsAt: { gte: today.end, lt: windowEnd }, status: { in: ["SCHEDULED", "CONFIRMED"] } } }),
      tx.appointment.groupBy({ by: ["status"], where: { ...apptScope, startsAt: { gte: windowStart, lt: windowEnd }, status: NOT_REQUESTS }, _count: { _all: true } }),
    ]);

    const counts = new Map(statusGroups.map((g) => [g.status as string, g._count._all]));
    const [todaysAppointments, recentAppointments] = await Promise.all([describeAppointments(tx, todays), describeAppointments(tx, recent)]);

    let billing: DashboardData["billing"] = null;
    if (canSeeBilling) {
      const invoiceScope = { clinicId: ctx.clinicId, ...branchFilter };
      const trendStart = istDayRange(now, -29).start;
      const monthStart = istMonthStart(now);
      const [succeeded, openInvoices, invoiceGroups] = await Promise.all([
        tx.payment.findMany({
          where: { clinicId: ctx.clinicId, status: "SUCCEEDED", paidAt: { gte: trendStart < monthStart ? trendStart : monthStart, lt: today.end }, invoice: invoiceScope },
          select: { amountPaise: true, paidAt: true },
        }),
        tx.invoice.findMany({
          where: { ...invoiceScope, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
          select: { totalPaise: true, payments: { where: { status: "SUCCEEDED" }, select: { amountPaise: true } } },
        }),
        tx.invoice.groupBy({ by: ["status"], where: invoiceScope, _count: { _all: true } }),
      ]);
      const byDay = new Map<string, number>();
      for (const p of succeeded) byDay.set(istDayKey(p.paidAt).date, (byDay.get(istDayKey(p.paidAt).date) ?? 0) + p.amountPaise);
      const todayKey = istTodayKey(now);
      const monthPrefix = todayKey.slice(0, 7);
      const invoiceCount = new Map(invoiceGroups.map((g) => [g.status as string, g._count._all]));
      billing = {
        todaysRevenue: (byDay.get(todayKey) ?? 0) / 100,
        monthRevenue: [...byDay.entries()].filter(([d]) => d.startsWith(monthPrefix)).reduce((s, [, v]) => s + v, 0) / 100,
        outstanding:
          openInvoices.reduce((s, inv) => s + Math.max(0, inv.totalPaise - inv.payments.reduce((p, x) => p + x.amountPaise, 0)), 0) / 100,
        invoiceCounts: {
          paid: invoiceCount.get("PAID") ?? 0,
          partiallyPaid: invoiceCount.get("PARTIALLY_PAID") ?? 0,
          pending: invoiceCount.get("PENDING") ?? 0,
        },
        revenueTrend: Array.from({ length: 30 }, (_, i) => {
          const date = istDayKey(istDayRange(now, i - 29).start).date;
          return { date, revenue: (byDay.get(date) ?? 0) / 100 };
        }),
      };
    }

    return {
      clinicName: ctx.clinicName,
      branchName: branch?.name ?? null,
      scope: own ? "own" : "clinic",
      totalPatients,
      activeDoctors,
      today: {
        total: todays.length,
        waiting: todays.filter((a) => a.status === "CHECKED_IN").length,
        completed: todays.filter((a) => a.status === "COMPLETED").length,
        online: todays.filter((a) => a.type === "ONLINE").length,
      },
      upcomingNext14Days,
      statusBreakdown: STATUS_ORDER.map((s) => ({ status: s.toLowerCase(), count: counts.get(s) ?? 0 })).filter((s) => s.count > 0),
      todaysAppointments,
      recentAppointments,
      billing,
    };
  });
}

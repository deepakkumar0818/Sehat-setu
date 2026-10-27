import "server-only";
import { withTenantDb, type TenantTx } from "@/server/db/tenant";
import { appointmentScopeFilter, hasAnyPermission, type TenantContext } from "@/server/auth/authorize";
import { istDayKey, istDayRange, istMonthStart, istTodayKey } from "@/lib/ist";
import { staffRoutePermissions } from "@/lib/auth/routes";
import { ageFrom, avatarColorFor } from "./mappers";

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

export interface DashboardPatient {
  id: string;
  name: string;
  patientNumber: string;
  age: number;
  gender: string;
  avatarColor: string;
  /** yyyy-MM-dd (IST) of their last completed visit, or null. */
  lastVisit: string | null;
  /** Their latest appointment's status (lower-case), or "active"/"inactive" when they have none. */
  status: string;
}

export interface DashboardPerson {
  id: string;
  name: string;
  /** Specialty for doctors, role label key for staff. */
  detail: string;
  status: "active" | "inactive";
  avatarColor: string;
}

export interface DashboardTeamGroup {
  items: DashboardPerson[];
  total: number;
}

/**
 * Shortcuts the viewer may use — each one only when they hold the permission
 * AND may open the page it leads to (the server re-checks every action).
 */
export type QuickActionKey =
  | "add_patient"
  | "book_appointment"
  | "waiting_room"
  | "booking_requests"
  | "add_doctor"
  | "add_receptionist"
  | "add_nurse"
  | "consultations"
  | "prescriptions"
  | "upload_report"
  | "billing"
  | "expenses"
  | "add_branch"
  | "patient_link"
  | "analytics";

export interface DashboardData {
  clinicName: string;
  branchName: string | null;
  scope: "clinic" | "own";
  /** null when the user's role can't see patients. */
  totalPatients: number | null;
  activeDoctors: number;
  /** Suspended doctors (shown under the active count). */
  inactiveDoctors: number;
  /** Patients registered before this month: the base for "vs last month". */
  patientsAtMonthStart: number | null;
  today: { total: number; waiting: number; completed: number; online: number; upcoming: number };
  /** Patients' online booking requests awaiting reception; null without appointment.update. */
  pendingRequests: number | null;
  /** The next appointments from now (today and later). */
  upcomingAppointments: DashboardAppointment[];
  /** null when the user's role can't see patients. */
  recentPatients: DashboardPatient[] | null;
  /** The clinic directory: doctors for every staff member; the staff groups need staff/user permissions. */
  team: {
    doctors: DashboardTeamGroup;
    nurses: DashboardTeamGroup | null;
    receptionists: DashboardTeamGroup | null;
    management: DashboardTeamGroup | null;
  } | null;
  quickActions: QuickActionKey[];
  /** For the "Patient link" shortcut (clinic administrators only): the clinic code in /join/<CODE>. */
  clinicCode: string | null;
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
const STAFF_VIEW = ["staff.view", "staff.manage", "user.view"];
const TEAM_SIZE = 4;

/** Each shortcut: the permissions it needs (any one) and the page it opens. */
const QUICK_ACTIONS: { key: QuickActionKey; anyOf: readonly string[]; allOf?: readonly string[]; path: string }[] = [
  { key: "add_patient", anyOf: ["patient.create"], path: "/patients" },
  { key: "book_appointment", anyOf: ["appointment.create"], path: "/appointments" },
  { key: "booking_requests", anyOf: ["appointment.update"], path: "/appointments" },
  { key: "waiting_room", anyOf: ["checkin.manage", "appointment.view", "own_appointments.view"], path: "/waiting-room" },
  { key: "consultations", anyOf: ["medical_record.view", "patient.medical_record.view"], path: "/consultations" },
  { key: "prescriptions", anyOf: ["prescription.manage", "prescription.view"], path: "/prescriptions" },
  { key: "upload_report", anyOf: ["lab_report.upload", "lab.manage"], path: "/reports" },
  { key: "add_doctor", anyOf: ["user.create"], allOf: ["doctor.manage"], path: "/doctor-roster" },
  { key: "add_receptionist", anyOf: ["user.create"], path: "/staff" },
  { key: "add_nurse", anyOf: ["user.create"], path: "/staff" },
  { key: "billing", anyOf: ["billing.manage", "invoice.create", "billing.view"], path: "/billing" },
  { key: "expenses", anyOf: ["billing.manage"], path: "/expenses" },
  { key: "analytics", anyOf: ["reports.view", "financial_reports.view"], path: "/analytics" },
  { key: "add_branch", anyOf: ["branch.create"], path: "/clinic/branches" },
  { key: "patient_link", anyOf: ["clinic.settings.manage"], path: "/settings" },
];

export function quickActionsFor(ctx: Pick<TenantContext, "permissions">): QuickActionKey[] {
  return QUICK_ACTIONS.filter((a) => {
    const route = staffRoutePermissions(a.path);
    return route !== undefined && hasAnyPermission(ctx, route) && hasAnyPermission(ctx, a.anyOf) && (a.allOf ?? []).every((k) => ctx.permissions.has(k));
  }).map((a) => a.key);
}
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
  const canSeeStaff = hasAnyPermission(ctx, STAFF_VIEW);
  const canReviewRequests = hasAnyPermission(ctx, ["appointment.update"]);
  const monthStart = istMonthStart(now);
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
    const patientScope = { clinicId: ctx.clinicId, status: { not: "ARCHIVED" as const }, ...(own ? { appointments: { some: { doctorId: ctx.doctorId! } } } : {}) };
    const [inactiveDoctors, patientsAtMonthStart, pendingRequests, upcoming, recentPatientRows, doctorRows, doctorTotal, staffRows] = await Promise.all([
      tx.doctorProfile.count({ where: { clinicId: ctx.clinicId, status: "INACTIVE", ...(ctx.branchId ? { branches: { some: { branchId: ctx.branchId } } } : {}) } }),
      canSeePatients ? tx.patient.count({ where: { ...patientScope, createdAt: { lt: monthStart } } }) : null,
      canReviewRequests ? tx.appointment.count({ where: { ...apptScope, status: "PENDING_APPROVAL", startsAt: { gte: now } } }) : null,
      tx.appointment.findMany({
        where: { ...apptScope, startsAt: { gte: now, lt: windowEnd }, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION"] } },
        orderBy: { startsAt: "asc" },
        take: 6,
        select: apptSelect,
      }),
      canSeePatients
        ? tx.patient.findMany({
            where: patientScope,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: 5,
            select: {
              id: true, name: true, patientNumber: true, dateOfBirth: true, gender: true, status: true,
              appointments: { where: { status: NOT_REQUESTS, ...doctorFilter }, orderBy: { startsAt: "desc" }, take: 1, select: { status: true } },
            },
          })
        : [],
      tx.doctorProfile.findMany({
        where: { clinicId: ctx.clinicId, ...(ctx.branchId ? { branches: { some: { branchId: ctx.branchId } } } : {}) },
        orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
        take: TEAM_SIZE,
        select: { id: true, status: true, user: { select: { name: true } }, specialty: { select: { name: true } } },
      }),
      tx.doctorProfile.count({ where: { clinicId: ctx.clinicId, ...(ctx.branchId ? { branches: { some: { branchId: ctx.branchId } } } : {}) } }),
      canSeeStaff
        ? tx.clinicMembership.findMany({
            where: {
              clinicId: ctx.clinicId,
              role: { key: { in: ["ADMINISTRATOR", "CLINIC_MANAGER", "RECEPTIONIST", "NURSE"] } },
              ...(ctx.branchId ? { OR: [{ branchId: ctx.branchId }, { branchId: null }] } : {}),
            },
            orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
            select: { id: true, status: true, role: { select: { key: true } }, user: { select: { name: true } } },
          })
        : null,
    ]);
    const quickActions = quickActionsFor(ctx);
    const clinicCode = quickActions.includes("patient_link")
      ? ((await tx.clinic.findFirst({ where: { id: ctx.clinicId }, select: { code: true } }))?.code ?? null)
      : null;
    const lastVisits = recentPatientRows.length
      ? await tx.appointment.groupBy({
          by: ["patientId"],
          where: { clinicId: ctx.clinicId, patientId: { in: recentPatientRows.map((p) => p.id) }, status: "COMPLETED", ...doctorFilter },
          _max: { startsAt: true },
        })
      : [];
    const lastVisitBy = new Map(lastVisits.map((v) => [v.patientId, v._max.startsAt]));
    const group = (keys: string[]): DashboardTeamGroup | null => {
      if (!staffRows) return null;
      const rows = staffRows.filter((m) => keys.includes(m.role.key));
      return {
        total: rows.length,
        items: rows.slice(0, TEAM_SIZE).map((m) => ({ id: m.id, name: m.user.name, detail: m.role.key, status: m.status === "ACTIVE" ? "active" : "inactive", avatarColor: avatarColorFor(m.id) })),
      };
    };

    const counts = new Map(statusGroups.map((g) => [g.status as string, g._count._all]));
    const [todaysAppointments, recentAppointments, upcomingAppointments] = await Promise.all([
      describeAppointments(tx, todays),
      describeAppointments(tx, recent),
      describeAppointments(tx, upcoming),
    ]);

    let billing: DashboardData["billing"] = null;
    if (canSeeBilling) {
      const invoiceScope = { clinicId: ctx.clinicId, ...branchFilter };
      const trendStart = istDayRange(now, -29).start;
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
      inactiveDoctors,
      patientsAtMonthStart,
      today: {
        total: todays.length,
        waiting: todays.filter((a) => a.status === "CHECKED_IN").length,
        completed: todays.filter((a) => a.status === "COMPLETED").length,
        online: todays.filter((a) => a.type === "ONLINE").length,
        upcoming: todays.filter((a) => (a.status === "SCHEDULED" || a.status === "CONFIRMED") && a.startsAt >= now).length,
      },
      pendingRequests,
      upcomingAppointments,
      recentPatients: canSeePatients
        ? recentPatientRows.map((p) => {
            const last = lastVisitBy.get(p.id);
            return {
              id: p.id,
              name: p.name,
              patientNumber: p.patientNumber,
              age: ageFrom(p.dateOfBirth, now),
              gender: p.gender.toLowerCase(),
              avatarColor: avatarColorFor(p.id),
              lastVisit: last ? istDayKey(last).date : null,
              status: p.status !== "ACTIVE" ? "inactive" : (p.appointments[0]?.status.toLowerCase() ?? "active"),
            };
          })
        : null,
      team: own
        ? null
        : {
            doctors: {
              total: doctorTotal,
              items: doctorRows.map((d) => ({ id: d.id, name: d.user.name, detail: d.specialty.name, status: d.status === "ACTIVE" ? "active" : "inactive", avatarColor: avatarColorFor(d.id) })),
            },
            nurses: group(["NURSE"]),
            receptionists: group(["RECEPTIONIST"]),
            management: group(["ADMINISTRATOR", "CLINIC_MANAGER"]),
          },
      quickActions,
      clinicCode,
      upcomingNext14Days,
      statusBreakdown: STATUS_ORDER.map((s) => ({ status: s.toLowerCase(), count: counts.get(s) ?? 0 })).filter((s) => s.count > 0),
      todaysAppointments,
      recentAppointments,
      billing,
    };
  });
}

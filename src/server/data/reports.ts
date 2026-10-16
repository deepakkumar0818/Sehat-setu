import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/server/auth/errors";
import { appointmentScopeFilter, assertBranchAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { AppointmentCounts, FinancialReport, OperationalReport, PaymentMethodKey, ReportScope } from "@/lib/live-types";
import {
  AGEING_BANDS,
  addDays,
  checkRange,
  eachDay,
  eachMonth,
  istDateOf,
  noShowRate,
  paiseToRupeesText,
  REPORT_EXPORTS,
  toCsv,
  type CsvCell,
  type ReportExportKey,
} from "@/lib/reports";
import { BILLING_VIEW } from "./billing";
import { runScoped } from "./scope";

// Clinic reports (P6.1): operational and financial aggregates for one verified
// TenantContext. The calculation rules are documented in src/lib/reports.ts.
//
// Every query (1) runs inside the caller's tenant transaction, so RLS limits it
// to their clinic, branch and record-level rights, and (2) ALSO filters
// explicitly by clinic, branch and — for doctors limited to their own
// appointments — doctor. Aggregation happens in SQL; only counts and amounts
// leave the database (no patient names, numbers or clinical details).
//
// A section the user's role can't read is returned as null with a reason,
// never as zeros: RLS would hide the rows, and an empty result would look like
// "nothing happened".

export const REPORTS_VIEW = ["reports.view"] as const;
export const REPORTS_EXPORT = ["reports.export"] as const;
/** Registration counts need clinic-wide patient visibility (assigned_patients.view sees only a doctor's own patients). */
const PATIENT_REPORT = ["patient.view", "patient.basic_info.view"] as const;
/** Consultation timestamps are clinical records (RLS consultations_read). */
const CONSULTATION_VIEW = ["medical_record.view", "patient.medical_record.view", "medical_record.manage"] as const;

export const reportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.union([z.literal("all"), z.string().uuid("Unknown branch.")]).optional(),
});

export const reportExportSchema = reportQuerySchema.extend({
  report: z.enum(REPORT_EXPORTS.map((r) => r.key) as [ReportExportKey, ...ReportExportKey[]]),
});

interface ResolvedScope {
  scope: ReportScope;
  start: Date;
  end: Date;
  branchId: string | null;
  doctorId: string | null;
  branchNames: Map<string, string>;
}

/** Validates the range and branch filter and works out what the user may see. */
async function resolveScope(ctx: TenantContext, tx: TenantTx, raw: unknown, now: Date): Promise<ResolvedScope> {
  const input = reportQuerySchema.parse(raw ?? {});
  const today = istDateOf(now);
  const to = input.to ?? today;
  const from = input.from ?? addDays(to, -29);
  const range = checkRange(from, to);
  if (!range.ok) throw new DataError("INVALID_INPUT", range.error);

  const requested = input.branchId && input.branchId !== "all" ? input.branchId : null;
  if (requested) assertBranchAccess(ctx, requested); // 403 for a branch outside the user's scope
  const branches = await tx.branch.findMany({
    where: { clinicId: ctx.clinicId, ...(ctx.branchId ? { id: ctx.branchId } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (requested && !branches.some((b) => b.id === requested)) throw new DataError("INVALID_INPUT", "Unknown branch.");

  const own = ctx.careScope === "own";
  return {
    start: range.start,
    end: range.end,
    branchId: requested ?? ctx.branchId,
    doctorId: own ? (appointmentScopeFilter(ctx).doctorId ?? null) : null,
    branchNames: new Map(branches.map((b) => [b.id, b.name])),
    scope: {
      from,
      to,
      branchId: requested ?? ctx.branchId,
      branchLocked: ctx.branchId !== null,
      branches,
      ownAppointmentsOnly: own,
      canViewFinancial: hasAnyPermission(ctx, BILLING_VIEW),
      canExport: hasAnyPermission(ctx, REPORTS_EXPORT),
      generatedAt: now.toISOString(),
    },
  };
}

// --- SQL fragments (column expressions are fixed strings; every value is a bound parameter) ---

const IST_DAY = (col: string) => Prisma.raw(`to_char((${col} AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD')`);

function appointmentFilter(ctx: TenantContext, s: ResolvedScope): Prisma.Sql {
  return Prisma.sql`a."clinicId" = ${ctx.clinicId}::uuid AND a."startsAt" >= ${s.start} AND a."startsAt" < ${s.end}
    ${s.branchId ? Prisma.sql`AND a."branchId" = ${s.branchId}::uuid` : Prisma.empty}
    ${s.doctorId ? Prisma.sql`AND a."doctorId" = ${s.doctorId}::uuid` : Prisma.empty}`;
}

const invoiceBranch = (s: ResolvedScope) => (s.branchId ? Prisma.sql`AND i."branchId" = ${s.branchId}::uuid` : Prisma.empty);

const emptyCounts = (): AppointmentCounts => ({ total: 0, completed: 0, upcoming: 0, inProgress: 0, cancelled: 0, noShow: 0 });

function addStatus(c: AppointmentCounts, status: string, n: number) {
  // Pending and declined patient requests never became appointments.
  if (status === "PENDING_APPROVAL" || status === "REJECTED") return;
  c.total += n;
  if (status === "COMPLETED") c.completed += n;
  else if (status === "SCHEDULED" || status === "CONFIRMED") c.upcoming += n;
  else if (status === "CHECKED_IN" || status === "IN_CONSULTATION") c.inProgress += n;
  else if (status === "CANCELLED") c.cancelled += n;
  else if (status === "NO_SHOW") c.noShow += n;
}

/** Counts per key (day, branch or doctor) and status, in one grouped query. */
async function appointmentGroups(tx: TenantTx, ctx: TenantContext, s: ResolvedScope, key: Prisma.Sql): Promise<Map<string, AppointmentCounts>> {
  const rows = await tx.$queryRaw<{ k: string; status: string; n: number }[]>`
    SELECT ${key} AS k, a.status::text AS status, count(*)::int AS n
    FROM appointments a
    WHERE ${appointmentFilter(ctx, s)}
    GROUP BY 1, 2`;
  const out = new Map<string, AppointmentCounts>();
  for (const r of rows) {
    const c = out.get(r.k) ?? emptyCounts();
    addStatus(c, r.status, r.n);
    out.set(r.k, c);
  }
  return out;
}

function sumCounts(items: Iterable<AppointmentCounts>): AppointmentCounts {
  const t = emptyCounts();
  for (const c of items) for (const k of Object.keys(t) as (keyof AppointmentCounts)[]) t[k] += c[k];
  return t;
}

async function appointmentSection(tx: TenantTx, ctx: TenantContext, s: ResolvedScope): Promise<OperationalReport["appointments"]> {
  const [byDay, byBranch] = await Promise.all([
    appointmentGroups(tx, ctx, s, IST_DAY('a."startsAt"')),
    appointmentGroups(tx, ctx, s, Prisma.raw(`a."branchId"::text`)),
  ]);
  const days = eachDay(s.scope);
  const daily = days.map((date) => ({ date, ...(byDay.get(date) ?? emptyCounts()) }));
  const monthly = eachMonth(s.scope).map((month) => ({ month, ...sumCounts(daily.filter((d) => d.date.startsWith(month))) }));
  return {
    totals: sumCounts(byDay.values()),
    byBranch: [...byBranch.entries()]
      .map(([branchId, c]) => ({ branchId, branchName: s.branchNames.get(branchId) ?? "Other branch", ...c }))
      .sort((a, b) => b.total - a.total || a.branchName.localeCompare(b.branchName)),
    daily,
    monthly,
  };
}

async function patientSection(tx: TenantTx, ctx: TenantContext, s: ResolvedScope): Promise<OperationalReport["patients"]> {
  const rows = await tx.$queryRaw<{ day: string; branch_id: string; n: number }[]>`
    SELECT ${IST_DAY('p."createdAt"')} AS day, p."branchId"::text AS branch_id, count(*)::int AS n
    FROM patients p
    WHERE p."clinicId" = ${ctx.clinicId}::uuid AND p."createdAt" >= ${s.start} AND p."createdAt" < ${s.end}
      ${s.branchId ? Prisma.sql`AND p."branchId" = ${s.branchId}::uuid` : Prisma.empty}
    GROUP BY 1, 2`;
  const perDay = new Map<string, number>();
  const perBranch = new Map<string, number>();
  for (const r of rows) {
    perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.n);
    perBranch.set(r.branch_id, (perBranch.get(r.branch_id) ?? 0) + r.n);
  }
  const daily = eachDay(s.scope).map((date) => ({ date, count: perDay.get(date) ?? 0 }));
  return {
    total: rows.reduce((t, r) => t + r.n, 0),
    byBranch: [...perBranch.entries()]
      .map(([branchId, count]) => ({ branchId, branchName: s.branchNames.get(branchId) ?? "Other branch", count }))
      .sort((a, b) => b.count - a.count || a.branchName.localeCompare(b.branchName)),
    daily,
    monthly: eachMonth(s.scope).map((month) => ({ month, count: daily.filter((d) => d.date.startsWith(month)).reduce((t, d) => t + d.count, 0) })),
  };
}

async function workloadSection(tx: TenantTx, ctx: TenantContext, s: ResolvedScope): Promise<OperationalReport["workload"]> {
  const byDoctor = await appointmentGroups(tx, ctx, s, Prisma.raw(`a."doctorId"::text`));
  const ids = [...byDoctor.keys()];
  const [profiles, durations] = await Promise.all([
    ids.length ? tx.doctorProfile.findMany({ where: { clinicId: ctx.clinicId, id: { in: ids } }, select: { id: true, user: { select: { name: true } } } }) : [],
    hasAnyPermission(ctx, CONSULTATION_VIEW) ? consultationDurations(tx, ctx, s) : null,
  ]);
  const names = new Map(profiles.map((p) => [p.id, p.user.name]));
  const doctors = ids
    .map((doctorId) => {
      const c = byDoctor.get(doctorId)!;
      const d = durations?.get(doctorId);
      return {
        doctorId,
        doctorName: names.get(doctorId) ?? "Doctor",
        ...c,
        noShowRate: noShowRate(c.completed, c.noShow),
        avgConsultationMinutes: d && d.samples > 0 ? round1(d.minutes / d.samples) : null,
        durationSamples: d?.samples ?? 0,
      };
    })
    .sort((a, b) => b.total - a.total || a.doctorName.localeCompare(b.doctorName));

  let duration: NonNullable<OperationalReport["workload"]>["duration"];
  if (!durations) duration = { available: false, reason: "not_permitted", excluded: 0 };
  else {
    const all = [...durations.values()];
    const samples = all.reduce((t, d) => t + d.samples, 0);
    const excluded = all.reduce((t, d) => t + d.excluded, 0);
    duration = samples > 0
      ? { available: true, avgMinutes: round1(all.reduce((t, d) => t + d.minutes, 0) / samples), samples, excluded }
      : { available: false, reason: "no_reliable_timestamps", excluded };
  }
  return { doctors, duration };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Completed consultations' length (finish − start) per doctor, counting only
 * consultations whose times are consistent: finished after it started, within
 * 4 hours, and started between 2 hours before and 1 day after the appointment.
 * Records imported or seeded with other timestamps are excluded, not guessed.
 */
async function consultationDurations(tx: TenantTx, ctx: TenantContext, s: ResolvedScope) {
  const rows = await tx.$queryRaw<{ doctor_id: string; samples: number; excluded: number; minutes: number | null }[]>`
    SELECT x.doctor_id, count(*) FILTER (WHERE x.ok)::int AS samples, count(*) FILTER (WHERE NOT x.ok)::int AS excluded,
           coalesce(sum(x.mins) FILTER (WHERE x.ok), 0)::float8 AS minutes
    FROM (
      SELECT a."doctorId"::text AS doctor_id,
             extract(epoch FROM (c."completedAt" - c."createdAt")) / 60.0 AS mins,
             (c."completedAt" > c."createdAt"
              AND c."completedAt" - c."createdAt" <= interval '4 hours'
              AND c."createdAt" >= a."startsAt" - interval '2 hours'
              AND c."createdAt" < a."startsAt" + interval '1 day') AS ok
      FROM consultations c
      JOIN appointments a ON a.id = c."appointmentId" AND a."clinicId" = c."clinicId"
      WHERE c."clinicId" = ${ctx.clinicId}::uuid AND c.status = 'COMPLETED' AND c."completedAt" IS NOT NULL AND ${appointmentFilter(ctx, s)}
    ) x
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.doctor_id, { samples: r.samples, excluded: r.excluded, minutes: Number(r.minutes ?? 0) }]));
}

// --- public API ---------------------------------------------------------------------

/** Appointment, new-patient and doctor-workload figures for a date range. */
export async function getOperationalReport(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<OperationalReport> {
  requirePermission(ctx, REPORTS_VIEW);
  return runScoped(ctx, db, async (tx) => {
    const s = await resolveScope(ctx, tx, raw, now);
    const unavailable: OperationalReport["unavailable"] = [];
    const canAppointments = ctx.careScope !== "none";
    const canPatients = hasAnyPermission(ctx, PATIENT_REPORT);
    if (!canAppointments) unavailable.push({ section: "appointments", reason: "not_permitted" }, { section: "workload", reason: "not_permitted" });
    if (!canPatients) unavailable.push({ section: "patients", reason: "not_permitted" });
    const [appointments, patients, workload] = await Promise.all([
      canAppointments ? appointmentSection(tx, ctx, s) : null,
      canPatients ? patientSection(tx, ctx, s) : null,
      canAppointments ? workloadSection(tx, ctx, s) : null,
    ]);
    return { scope: s.scope, appointments, patients, workload, unavailable };
  });
}

const METHOD_ORDER: PaymentMethodKey[] = ["cash", "upi", "card", "bank_transfer", "online"];

/** Collections, refunds, billed value and outstanding balances. Needs a billing permission as well as reports.view. */
export async function getFinancialReport(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<FinancialReport> {
  requirePermission(ctx, REPORTS_VIEW);
  requirePermission(ctx, BILLING_VIEW);
  return runScoped(ctx, db, async (tx) => {
    const s = await resolveScope(ctx, tx, raw, now);
    const today = istDateOf(now);
    const [payments, billedRows, ageing] = await Promise.all([
      tx.$queryRaw<{ day: string; method: string; branch_id: string; status: string; n: number; paise: bigint }[]>`
        SELECT ${IST_DAY('p."paidAt"')} AS day, p.method::text AS method, i."branchId"::text AS branch_id, p.status::text AS status,
               count(*)::int AS n, sum(p."amountPaise")::bigint AS paise
        FROM payments p
        JOIN invoices i ON i.id = p."invoiceId" AND i."clinicId" = p."clinicId"
        WHERE p."clinicId" = ${ctx.clinicId}::uuid AND p."paidAt" >= ${s.start} AND p."paidAt" < ${s.end}
          AND p.status IN ('SUCCEEDED', 'REFUNDED') ${invoiceBranch(s)}
        GROUP BY 1, 2, 3, 4`,
      tx.$queryRaw<{ invoices: number; invoiced: bigint; voids: number; voided: bigint }[]>`
        SELECT count(*) FILTER (WHERE i.status <> 'VOID')::int AS invoices,
               coalesce(sum(i."totalPaise") FILTER (WHERE i.status <> 'VOID'), 0)::bigint AS invoiced,
               count(*) FILTER (WHERE i.status = 'VOID')::int AS voids,
               coalesce(sum(i."totalPaise") FILTER (WHERE i.status = 'VOID'), 0)::bigint AS voided
        FROM invoices i
        WHERE i."clinicId" = ${ctx.clinicId}::uuid AND i."issuedAt" >= ${s.start} AND i."issuedAt" < ${s.end} ${invoiceBranch(s)}`,
      tx.$queryRaw<{ band: string; n: number; balance: bigint }[]>`
        WITH open AS (
          SELECT greatest(0, i."totalPaise" - coalesce((SELECT sum(p."amountPaise") FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'SUCCEEDED'), 0)) AS balance,
                 ${today}::date - coalesce(i."dueDate", (i."issuedAt" AT TIME ZONE 'Asia/Kolkata')::date) AS overdue
          FROM invoices i
          WHERE i."clinicId" = ${ctx.clinicId}::uuid AND i.status IN ('PENDING', 'PARTIALLY_PAID') ${invoiceBranch(s)}
        )
        SELECT CASE WHEN overdue <= 0 THEN 'current' WHEN overdue <= 30 THEN 'd1_30' WHEN overdue <= 60 THEN 'd31_60'
                    WHEN overdue <= 90 THEN 'd61_90' ELSE 'd90_plus' END AS band,
               count(*)::int AS n, sum(balance)::bigint AS balance
        FROM open WHERE balance > 0
        GROUP BY 1`,
    ]);

    const daily = new Map(eachDay(s.scope).map((date) => [date, { date, netPaise: 0, refundedPaise: 0 }]));
    const methods = new Map(METHOD_ORDER.map((method) => [method, { method, netPaise: 0, payments: 0, refundedPaise: 0, refunds: 0 }]));
    const branches = new Map<string, { branchId: string; branchName: string; netPaise: number; refundedPaise: number }>();
    let netPaise = 0, refundedPaise = 0, paymentCount = 0, refundCount = 0;
    for (const r of payments) {
      const paise = Number(r.paise);
      const succeeded = r.status === "SUCCEEDED";
      const day = daily.get(r.day);
      const method = methods.get(r.method.toLowerCase() as PaymentMethodKey);
      const branch = branches.get(r.branch_id) ?? { branchId: r.branch_id, branchName: s.branchNames.get(r.branch_id) ?? "Other branch", netPaise: 0, refundedPaise: 0 };
      branches.set(r.branch_id, branch);
      if (succeeded) {
        netPaise += paise; paymentCount += r.n;
        if (day) day.netPaise += paise;
        if (method) { method.netPaise += paise; method.payments += r.n; }
        branch.netPaise += paise;
      } else {
        refundedPaise += paise; refundCount += r.n;
        if (day) day.refundedPaise += paise;
        if (method) { method.refundedPaise += paise; method.refunds += r.n; }
        branch.refundedPaise += paise;
      }
    }
    const billed = billedRows[0];
    const bandRows = new Map(ageing.map((r) => [r.band, r]));
    const bands = AGEING_BANDS.map(({ key }) => ({ band: key, invoiceCount: bandRows.get(key)?.n ?? 0, balancePaise: Number(bandRows.get(key)?.balance ?? 0) }));
    return {
      scope: s.scope,
      collections: {
        netPaise,
        refundedPaise,
        grossPaise: netPaise + refundedPaise,
        paymentCount,
        refundCount,
        daily: [...daily.values()],
        byMethod: [...methods.values()],
        byBranch: [...branches.values()].sort((a, b) => b.netPaise - a.netPaise || a.branchName.localeCompare(b.branchName)),
      },
      billed: { invoicedPaise: Number(billed.invoiced), invoiceCount: billed.invoices, voidCount: billed.voids, voidPaise: Number(billed.voided) },
      outstanding: {
        asOf: today,
        totalPaise: bands.reduce((t, b) => t + b.balancePaise, 0),
        invoiceCount: bands.reduce((t, b) => t + b.invoiceCount, 0),
        bands,
      },
    };
  });
}

// --- CSV export -----------------------------------------------------------------------

export interface ReportFile {
  filename: string;
  csv: string;
  rows: number;
}

const pct = (rate: number | null) => (rate === null ? null : Math.round(rate * 1000) / 10);
const rupees = paiseToRupeesText;
const COUNT_HEADERS = ["Total", "Completed", "Upcoming", "In progress", "Cancelled", "No-shows"];
const countCells = (c: AppointmentCounts): CsvCell[] => [c.total, c.completed, c.upcoming, c.inProgress, c.cancelled, c.noShow];
const BAND_LABEL = new Map(AGEING_BANDS.map((b) => [b.key, b.label]));

function unavailable(): never {
  throw new AuthError("FORBIDDEN");
}

/**
 * One report as CSV. Needs reports.export plus whatever the report itself
 * needs; applies the same clinic/branch/doctor scope as the page. Records an
 * audit event (which report, range and branch filter, and the row count —
 * never the figures or any patient detail) in the same transaction.
 */
export async function exportReport(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<ReportFile> {
  requirePermission(ctx, REPORTS_VIEW);
  requirePermission(ctx, REPORTS_EXPORT);
  const { report, ...query } = reportExportSchema.parse(raw ?? {});
  return runScoped(ctx, db, async (tx) => {
    let header: string[];
    let rows: CsvCell[][];
    let scope: ReportScope;
    if (report === "collections" || report === "payment_methods" || report === "outstanding_ageing") {
      const f = await getFinancialReport(ctx, query, tx, now);
      scope = f.scope;
      if (report === "collections") {
        header = ["Date", "Collected (net, ₹)", "Refunded (₹)"];
        rows = f.collections.daily.map((d) => [d.date, rupees(d.netPaise), rupees(d.refundedPaise)]);
      } else if (report === "payment_methods") {
        header = ["Method", "Payments", "Collected (net, ₹)", "Refunds", "Refunded (₹)"];
        rows = f.collections.byMethod.map((m) => [m.method, m.payments, rupees(m.netPaise), m.refunds, rupees(m.refundedPaise)]);
      } else {
        header = [`Age (as of ${f.outstanding.asOf})`, "Invoices", "Outstanding (₹)"];
        rows = f.outstanding.bands.map((b) => [BAND_LABEL.get(b.band) ?? b.band, b.invoiceCount, rupees(b.balancePaise)]);
      }
    } else {
      const o = await getOperationalReport(ctx, query, tx, now);
      scope = o.scope;
      if (report === "appointments") {
        if (!o.appointments) unavailable();
        header = ["Date", ...COUNT_HEADERS];
        rows = o.appointments.daily.map((d) => [d.date, ...countCells(d)]);
      } else if (report === "doctor_workload") {
        if (!o.workload) unavailable();
        header = ["Doctor", ...COUNT_HEADERS, "No-show rate (%)", "Average consultation (min)", "Consultations timed"];
        rows = o.workload.doctors.map((d) => [d.doctorName, ...countCells(d), pct(d.noShowRate), d.avgConsultationMinutes, d.durationSamples]);
      } else {
        if (!o.patients) unavailable();
        header = ["Date", "New patients"];
        rows = o.patients.daily.map((d) => [d.date, d.count]);
      }
    }
    await tx.$executeRaw`SELECT app.log_event('report.exported', 'SUCCESS', 'report', ${report}, NULL, NULL, NULL,
      ${JSON.stringify({ from: scope.from, to: scope.to, branch: scope.branchId ?? "all", rows: rows.length })}::jsonb)`;
    return { filename: `sehat-setu_${report}_${scope.from}_to_${scope.to}.csv`, csv: toCsv(header, rows), rows: rows.length };
  });
}


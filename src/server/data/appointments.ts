import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { appointmentScopeFilter, assertBranchAccess, assertRecordAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { istDayKey, istDayRange } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { AppointmentWithNames } from "@/services/appointments";
import {
  appointmentStatusFromUi,
  appointmentStatusToUi,
  appointmentTypeFromUi,
  appointmentTypeToUi,
  invoiceStatusToPayment,
  istToInstant,
  REVIEW_STATUSES,
  type DbAppointmentStatus,
  type DbAppointmentType,
} from "./mappers";
import { slotTimesFor } from "@/lib/clinic-hours";
import { loadClinicSettings } from "./clinic-settings";
import { pageArgs, runScoped, type Page } from "./scope";

// Appointments — branch-scoped. careScope "clinic" sees the (branch-filtered)
// clinic schedule; "own" (doctors with own_appointments.view) sees only their
// own. RLS enforces the same rules independently.

export const APPOINTMENT_VIEW = ["appointment.view", "own_appointments.view", "checkin.manage"] as const;
const BILLING_VIEW = ["billing.view", "invoice.view", "billing.manage"];
const INVOICE_CREATE = ["invoice.create", "billing.manage"];
const CONSULT_WRITE = ["medical_notes.create", "medical_notes.update", "medical_record.manage", "patient.medical_record.update"];
const ACTIVE_STATUSES: DbAppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CONSULTATION", "COMPLETED"];

const apptSelect = {
  id: true, clinicId: true, branchId: true, patientId: true, doctorId: true, startsAt: true, durationMinutes: true, type: true,
  status: true, reason: true, notes: true, checkedInAt: true, createdAt: true, consultation: { select: { id: true } },
} as const;

type ApptRow = {
  id: string; clinicId: string; branchId: string; patientId: string; doctorId: string; startsAt: Date; durationMinutes: number;
  type: DbAppointmentType; status: DbAppointmentStatus; reason: string; notes: string | null; checkedInAt: Date | null;
  createdAt: Date; consultation: { id: string } | null;
};

/** Names, fee and payment status for rows, resolved separately so anything RLS hides degrades instead of failing. */
async function describe(ctx: TenantContext, tx: TenantTx, rows: ApptRow[]): Promise<AppointmentWithNames[]> {
  if (rows.length === 0) return [];
  const canSeeBilling = hasAnyPermission(ctx, BILLING_VIEW);
  const canCreateInvoice = canSeeBilling && hasAnyPermission(ctx, INVOICE_CREATE);
  const canWriteNotes = hasAnyPermission(ctx, CONSULT_WRITE);
  const [patients, doctors, invoices] = await Promise.all([
    tx.patient.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } }, select: { id: true, name: true } }),
    tx.doctorProfile.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.doctorId))] } },
      select: { id: true, consultationFeePaise: true, user: { select: { name: true } } },
    }),
    canSeeBilling
      ? tx.invoice.findMany({ where: { appointmentId: { in: rows.map((r) => r.id) } }, select: { id: true, appointmentId: true, status: true } })
      : Promise.resolve([]),
  ]);
  const patientName = new Map(patients.map((p) => [p.id, p.name]));
  const doctorById = new Map(doctors.map((d) => [d.id, d]));
  const invoiceByAppt = new Map(invoices.map((i) => [i.appointmentId, i]));
  return rows.map((r) => {
    const key = istDayKey(r.startsAt);
    const invoice = invoiceByAppt.get(r.id);
    const doctor = doctorById.get(r.doctorId);
    return {
      id: r.id,
      patientId: r.patientId,
      doctorId: r.doctorId,
      branchId: r.branchId,
      date: key.date,
      time: key.time,
      durationMinutes: r.durationMinutes,
      type: appointmentTypeToUi(r.type),
      status: appointmentStatusToUi(r.status),
      reason: r.reason,
      notes: r.notes ?? undefined,
      paymentStatus: invoiceStatusToPayment(invoice?.status),
      billingHidden: !canSeeBilling,
      canCreateInvoice,
      canConsult: canWriteNotes && ctx.doctorId !== null && ctx.doctorId === r.doctorId,
      fee: (doctor?.consultationFeePaise ?? 0) / 100,
      createdAt: r.createdAt.toISOString(),
      checkedInAt: r.checkedInAt?.toISOString(),
      waitStartedAt: r.checkedInAt?.toISOString(),
      consultationId: r.consultation?.id,
      invoiceId: invoice?.id,
      patientName: patientName.get(r.patientId) ?? "—",
      doctorName: doctor?.user.name ?? "—",
    };
  });
}

/** Base filter every appointment query starts from (clinic, branch restriction, doctor scope). */
function scopeWhere(ctx: TenantContext, branchId?: string) {
  if (branchId && branchId !== "all") assertBranchAccess(ctx, branchId);
  const branch = branchId && branchId !== "all" ? branchId : ctx.branchId;
  return { clinicId: ctx.clinicId, ...(branch ? { branchId: branch } : {}), ...appointmentScopeFilter(ctx) };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listAppointmentsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  date: isoDate.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  doctorId: z.string().optional(),
  branchId: z.string().optional(),
  status: z.enum(["upcoming", "waiting", "in_consultation", "completed", "cancelled", "no_show", "pending_approval", "rejected", "all"]).optional(),
  type: z.enum(["in_person", "online", "follow_up", "walk_in", "all"]).optional(),
  patientId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listAppointments(ctx: TenantContext, input: z.infer<typeof listAppointmentsSchema>, db?: TenantTx): Promise<Page<AppointmentWithNames>> {
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const startsAt: { gte?: Date; lt?: Date } = {};
  if (input.date) Object.assign(startsAt, { gte: istToInstant(input.date, "00:00"), lt: new Date(istToInstant(input.date, "00:00").getTime() + 864e5) });
  if (input.dateFrom) startsAt.gte = istToInstant(input.dateFrom, "00:00");
  if (input.dateTo) startsAt.lt = new Date(istToInstant(input.dateTo, "00:00").getTime() + 864e5);
  const search = input.search?.trim();
  const where = {
    ...scopeWhere(ctx, input.branchId),
    ...(Object.keys(startsAt).length ? { startsAt } : {}),
    ...(input.doctorId && input.doctorId !== "all" && ctx.careScope === "clinic" ? { doctorId: input.doctorId } : {}),
    // Patient requests (pending / declined) appear only when asked for by status: they aren't appointments yet.
    status: input.status && input.status !== "all" ? { in: appointmentStatusFromUi(input.status) } : { notIn: REVIEW_STATUSES },
    ...(input.type && input.type !== "all" ? { type: appointmentTypeFromUi(input.type) } : {}),
    ...(input.patientId ? { patientId: input.patientId } : {}),
    ...(search
      ? {
          OR: [
            { reason: { contains: search, mode: "insensitive" as const } },
            { patient: { name: { contains: search, mode: "insensitive" as const } } },
            { patient: { patientNumber: { contains: search, mode: "insensitive" as const } } },
            { doctor: { user: { name: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.appointment.findMany({ where, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip, take, select: apptSelect }),
      tx.appointment.count({ where }),
    ]);
    return { items: await describe(ctx, tx, rows as ApptRow[]), total, page, pageSize };
  });
}

async function loadOne(ctx: TenantContext, tx: TenantTx, id: string): Promise<ApptRow> {
  if (!z.string().uuid().safeParse(id).success) throw new AuthError("NOT_FOUND");
  const row = await tx.appointment.findFirst({ where: { id, ...scopeWhere(ctx) }, select: apptSelect });
  return assertRecordAccess(ctx, row as ApptRow | null);
}

export async function getAppointment(ctx: TenantContext, id: string, db?: TenantTx): Promise<AppointmentWithNames> {
  return runScoped(ctx, db, async (tx) => (await describe(ctx, tx, [await loadOne(ctx, tx, id)]))[0]);
}

export async function getTodaysAppointments(ctx: TenantContext, branchId: string | undefined, db?: TenantTx, now = new Date()): Promise<AppointmentWithNames[]> {
  const today = istDayRange(now, 0);
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.appointment.findMany({
      where: { ...scopeWhere(ctx, branchId), startsAt: { gte: today.start, lt: today.end }, status: { notIn: REVIEW_STATUSES } },
      orderBy: { startsAt: "asc" },
      select: apptSelect,
    });
    return describe(ctx, tx, rows as ApptRow[]);
  });
}

export async function getWaitingRoom(ctx: TenantContext, branchId: string | undefined, db?: TenantTx, now = new Date()): Promise<AppointmentWithNames[]> {
  const today = istDayRange(now, 0);
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.appointment.findMany({
      where: { ...scopeWhere(ctx, branchId), startsAt: { gte: today.start, lt: today.end }, status: { in: ["CHECKED_IN", "IN_CONSULTATION"] } },
      orderBy: [{ checkedInAt: "asc" }, { startsAt: "asc" }],
      select: apptSelect,
    });
    return describe(ctx, tx, rows as ApptRow[]);
  });
}

/** Free slots for a doctor on an IST date, from the clinic's timings (Settings). */
export async function getAvailableSlots(ctx: TenantContext, doctorId: string, date: string, db?: TenantTx, now = new Date()): Promise<string[]> {
  if (!isoDate.safeParse(date).success || !z.string().uuid().safeParse(doctorId).success) throw new DataError("INVALID_INPUT", "Invalid doctor or date.");
  const dayStart = istToInstant(date, "00:00");
  return runScoped(ctx, db, async (tx) => {
    const doctor = await tx.doctorProfile.findFirst({ where: { id: doctorId, clinicId: ctx.clinicId, status: "ACTIVE" }, select: { id: true } });
    if (!doctor) throw new AuthError("NOT_FOUND");
    // Every active booking for this doctor counts — not just ones this user can see —
    // so a branch-restricted user is never offered a slot that's taken elsewhere.
    const settings = await loadClinicSettings(tx, ctx.clinicId);
    const busy = await busyRanges(tx, doctorId, dayStart, new Date(dayStart.getTime() + 864e5));
    return slotTimesFor(date, settings).filter((t) => {
      const start = istToInstant(date, t).getTime();
      const end = start + settings.slotMinutes * 60_000;
      return start > now.getTime() && !busy.some((b) => b.start.getTime() < end && b.end.getTime() > start);
    });
  });
}

export const createAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  branchId: z.string().optional(),
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/),
  type: z.enum(["in_person", "online", "follow_up", "walk_in"]),
  reason: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * A doctor's booked time overlapping [from, to), across ALL branches and
 * bookings — via the app.doctor_busy_ranges() SECURITY DEFINER function, which
 * reveals only times (never patients) and only for doctors of the caller's own
 * clinic. `exceptId`: the appointment being moved, which doesn't block itself.
 */
async function busyRanges(tx: TenantTx, doctorId: string, from: Date, to: Date, exceptId: string | null = null): Promise<{ start: Date; end: Date }[]> {
  const rows = await tx.$queryRaw<{ starts_at: Date; ends_at: Date }[]>`
    SELECT starts_at, ends_at FROM app.doctor_busy_ranges(${doctorId}::uuid, ${from}, ${to}, ${exceptId}::uuid)`;
  return rows.map((r) => ({ start: r.starts_at, end: r.ends_at }));
}

/**
 * Prevents two concurrent bookings of a doctor that overlap: the same lock as
 * the patient and approval paths (app.lock_doctor_slot: per start time and per
 * doctor-day), then the time span checked under it.
 */
async function lockSlot(tx: TenantTx, doctorId: string, startsAt: Date, minutes: number, exceptId: string | null = null) {
  await tx.$executeRaw`SELECT app.lock_doctor_slot(${doctorId}::uuid, ${startsAt})`;
  const busy = await busyRanges(tx, doctorId, startsAt, new Date(startsAt.getTime() + minutes * 60_000), exceptId);
  if (busy.length > 0) throw new DataError("SLOT_TAKEN", "That doctor already has an appointment at this time. Pick another slot.");
}

export async function createAppointment(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<AppointmentWithNames> {
  requirePermission(ctx, "appointment.create");
  const input = createAppointmentSchema.parse(raw);
  let startsAt: Date;
  try {
    startsAt = istToInstant(input.date, input.time);
  } catch {
    throw new DataError("INVALID_INPUT", "Enter a valid date and time.");
  }
  if (startsAt.getTime() < now.getTime() - 5 * 60_000) throw new DataError("INVALID_INPUT", "Appointments can't be booked in the past.");

  return runScoped(ctx, db, async (tx) => {
    const [patient, doctor] = await Promise.all([
      tx.patient.findFirst({ where: { id: input.patientId, clinicId: ctx.clinicId }, select: { id: true, branchId: true, status: true } }),
      tx.doctorProfile.findFirst({ where: { id: input.doctorId, clinicId: ctx.clinicId, status: "ACTIVE" }, select: { id: true, branches: { select: { branchId: true, isPrimary: true } } } }),
    ]);
    if (!patient || patient.status === "ARCHIVED") throw new DataError("INVALID_INPUT", "Choose an active patient of your clinic.");
    if (!doctor) throw new DataError("INVALID_INPUT", "Choose an active doctor of your clinic.");

    // Branch: the requested one, else the user's own branch, else the doctor's primary branch.
    const doctorBranches = doctor.branches.map((b) => b.branchId);
    const branchId =
      (input.branchId && input.branchId !== "all" ? input.branchId : undefined) ??
      (ctx.branchId && doctorBranches.includes(ctx.branchId) ? ctx.branchId : undefined) ??
      doctor.branches.find((b) => b.isPrimary)?.branchId ??
      doctorBranches[0];
    if (!branchId || !doctorBranches.includes(branchId)) throw new DataError("INVALID_INPUT", "That doctor doesn't work at the selected branch.");
    assertBranchAccess(ctx, branchId);

    // Visits last one slot of the clinic's timings; a follow-up at most 15 minutes.
    const { slotMinutes } = await loadClinicSettings(tx, ctx.clinicId);
    const durationMinutes = input.type === "follow_up" ? Math.min(15, slotMinutes) : slotMinutes;
    await lockSlot(tx, doctor.id, startsAt, durationMinutes);
    const row = await tx.appointment.create({
      data: {
        clinicId: ctx.clinicId,
        branchId,
        patientId: patient.id,
        doctorId: doctor.id,
        startsAt,
        durationMinutes,
        type: appointmentTypeFromUi(input.type),
        status: "SCHEDULED",
        reason: input.reason,
        notes: input.notes || null,
      },
      select: apptSelect,
    });
    return (await describe(ctx, tx, [row as ApptRow]))[0];
  });
}

type Transition = "check-in" | "cancel" | "no-show";

const TRANSITIONS: Record<Transition, { from: DbAppointmentStatus[]; to: DbAppointmentStatus; permission: string[] }> = {
  "check-in": { from: ["SCHEDULED", "CONFIRMED"], to: "CHECKED_IN", permission: ["checkin.manage", "appointment.update"] },
  cancel: { from: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"], to: "CANCELLED", permission: ["appointment.cancel", "appointment.update", "own_appointments.manage"] },
  "no-show": { from: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"], to: "NO_SHOW", permission: ["appointment.update", "checkin.manage", "own_appointments.manage"] },
};

export function isTransition(value: string): value is Transition {
  return value in TRANSITIONS;
}

export async function transitionAppointment(ctx: TenantContext, id: string, action: Transition, db?: TenantTx, now = new Date()): Promise<AppointmentWithNames> {
  const rule = TRANSITIONS[action];
  requirePermission(ctx, rule.permission);
  return runScoped(ctx, db, async (tx) => {
    const current = await loadOne(ctx, tx, id);
    if (!rule.from.includes(current.status)) {
      throw new DataError("INVALID_TRANSITION", `A ${appointmentStatusToUi(current.status).replace("_", " ")} appointment can't be ${action === "check-in" ? "checked in" : action === "cancel" ? "cancelled" : "marked no-show"}.`);
    }
    // Conditional update: if another request changed the status meanwhile, nothing is updated.
    const updated = await tx.appointment.updateMany({
      where: { id, clinicId: ctx.clinicId, status: { in: rule.from } },
      data: { status: rule.to, ...(rule.to === "CHECKED_IN" && { checkedInAt: now }), ...(rule.to === "CANCELLED" && { cancelledAt: now }) },
    });
    if (updated.count !== 1) throw new DataError("INVALID_TRANSITION", "This appointment was just changed by someone else. Refresh and try again.");
    return (await describe(ctx, tx, [await loadOne(ctx, tx, id)]))[0];
  });
}

export const rescheduleSchema = z.object({ date: isoDate, time: z.string().regex(/^\d{2}:\d{2}$/) });

export async function rescheduleAppointment(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<AppointmentWithNames> {
  if (!hasAnyPermission(ctx, ["appointment.update", "own_appointments.manage"])) throw new AuthError("FORBIDDEN");
  const input = rescheduleSchema.parse(raw);
  let startsAt: Date;
  try {
    startsAt = istToInstant(input.date, input.time);
  } catch {
    throw new DataError("INVALID_INPUT", "Enter a valid date and time.");
  }
  if (startsAt.getTime() < now.getTime() - 5 * 60_000) throw new DataError("INVALID_INPUT", "Appointments can't be moved into the past.");
  return runScoped(ctx, db, async (tx) => {
    const current = await loadOne(ctx, tx, id);
    if (!["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"].includes(current.status)) {
      throw new DataError("INVALID_TRANSITION", "Only appointments that haven't started can be rescheduled.");
    }
    // Only checked when the time changes, so the appointment's own current slot never counts against it.
    if (current.startsAt.getTime() !== startsAt.getTime()) await lockSlot(tx, current.doctorId, startsAt, current.durationMinutes, current.id);
    await tx.appointment.update({ where: { id }, data: { startsAt, status: "SCHEDULED", checkedInAt: null, cancelledAt: null } });
    return (await describe(ctx, tx, [await loadOne(ctx, tx, id)]))[0];
  });
}

/** Appointment statuses that still occupy a slot. */
export const OCCUPYING_STATUSES = ACTIVE_STATUSES;

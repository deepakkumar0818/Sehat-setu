import "server-only";
import { onlinePaymentsConfigured } from "@/server/payments/razorpay";
import { refundBookingFees } from "./online-payments";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import type { PatientContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import { istDayKey } from "@/lib/ist";
import type {
  PortalAppointment,
  PortalAppointmentScope,
  PortalBookingOptions,
  PortalClinicRecord,
  PortalDashboard,
  PortalInvoice,
 PortalClinicContact, } from "@/lib/live-types";
import { appointmentTypeToUi, genderToUi, type DbAppointmentStatus, type DbAppointmentType } from "./mappers";
import { lookupNames } from "./documents";
import { eligibleDocumentWhere, eligibleReportWhere } from "./portal";
import { submitSymptomReport } from "./patient-intake";
import {
  MAX_DAYS_AHEAD,
  appointmentReference,
  appointmentsQuerySchema,
  bookableSlots,
  bookingSchema,
  mapBookingDbError,
  patientCanChange,
  portalStatus,
  rescheduleSchema,
  scopeFilter,
  slotInstant,
  slotsQuerySchema,
} from "./portal-booking-rules";
import { pageArgs, runPatientScoped, type Page } from "./scope";

// Patient portal: the signed-in patient's OWN appointments, booking, invoices
// and dashboard (migration 20261028000000_patient_self_booking).
//
// Who: PatientContext only (verified session + ACTIVE PATIENT membership + a
// record linked by the clinic's code or self-registration). The patient ids
// come only from that link, never from the browser.
// Reads run in the patient's own transaction, where RLS (appointments_read,
// invoices_read, patients_read: own rows only) applies; each query repeats the
// patient filter explicitly. Writes go through SECURITY DEFINER functions that
// take the patient from app.current_patient_ids() and re-validate the slot,
// doctor, branch and limits — availability shown in the browser is only a hint.
// Queries run one after another (one connection per transaction).

const apptSelect = {
  id: true, branchId: true, doctorId: true, startsAt: true, durationMinutes: true, type: true, status: true, reason: true, rejectionReason: true,
} as const;
type ApptRow = {
  id: string; branchId: string; doctorId: string; startsAt: Date; durationMinutes: number; type: DbAppointmentType; status: DbAppointmentStatus; reason: string;
  rejectionReason: string | null;
};

const own = (ctx: PatientContext) => ({ clinicId: ctx.clinicId, patientId: { in: ctx.patientIds } });

async function describe(tx: TenantTx, rows: ApptRow[], now: Date): Promise<PortalAppointment[]> {
  if (rows.length === 0) return [];
  const names = await lookupNames(tx, { branches: rows.map((r) => r.branchId), doctors: rows.map((r) => r.doctorId) });
  const specialties = await tx.doctorProfile.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.doctorId))] } },
    select: { id: true, consultationFeePaise: true, specialty: { select: { name: true } } },
  });
  const specialty = new Map(specialties.map((d) => [d.id, d.specialty?.name ?? null]));
  const feeOf = new Map(specialties.map((d) => [d.id, d.consultationFeePaise]));
  // Online booking-fee state (the patient's own orders and bills, under RLS). Mirrors app.online_payable.
  const ids = rows.map((r) => r.id);
  const payOnline = onlinePaymentsConfigured();
  const [orders, invoices] = await Promise.all([
    tx.onlinePaymentOrder.findMany({ where: { appointmentId: { in: ids }, purpose: "BOOKING_FEE", status: { not: "CREATED" } }, select: { appointmentId: true, status: true } }),
    tx.invoice.findMany({ where: { appointmentId: { in: ids } }, select: { appointmentId: true } }),
  ]);
  const billed = new Set(invoices.map((i) => i.appointmentId));
  return rows.map((r) => {
    const key = istDayKey(r.startsAt);
    const changeable = patientCanChange(r.status, r.startsAt, now);
    const mine = orders.filter((o) => o.appointmentId === r.id);
    const feePaid = mine.some((o) => o.status === "PAID");
    const feeRefunded = !feePaid && mine.some((o) => o.status === "REFUNDED" || o.status === "REFUND_PENDING");
    const fee = feeOf.get(r.doctorId) ?? 0;
    return {
      id: r.id,
      reference: appointmentReference(r.id),
      date: key.date,
      time: key.time,
      startsAt: r.startsAt.toISOString(),
      durationMinutes: r.durationMinutes,
      type: appointmentTypeToUi(r.type) as PortalAppointment["type"],
      status: portalStatus(r.status),
      reason: r.reason,
      doctorId: r.doctorId,
      doctorName: names.doctor.get(r.doctorId)?.name ?? null,
      specialty: specialty.get(r.doctorId) ?? null,
      branchId: r.branchId,
      branchName: names.branch.get(r.branchId)?.name ?? null,
      canCancel: changeable,
      canReschedule: changeable,
      // Reception's reason is written for the patient; shown only on a declined request.
      rejectionReason: r.status === "REJECTED" ? r.rejectionReason : null,
      fee: fee / 100,
      feePaid,
      feeRefunded,
      canPayFee: payOnline && changeable && r.status !== "CHECKED_IN" && fee >= 100 && mine.length === 0 && !billed.has(r.id),
    };
  });
}

export async function listMyAppointments(ctx: PatientContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<Page<PortalAppointment>> {
  const input = appointmentsQuerySchema.parse(raw ?? {});
  const scope: PortalAppointmentScope = input.scope ?? "upcoming";
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 50);
  const where = { ...own(ctx), ...scopeFilter(scope, now) };
  return runPatientScoped(ctx, db, async (tx) => {
    const rows = await tx.appointment.findMany({
      where,
      orderBy: [{ startsAt: scope === "upcoming" ? "asc" : "desc" }, { id: "asc" }],
      skip,
      take,
      select: apptSelect,
    });
    const total = await tx.appointment.count({ where });
    return { items: await describe(tx, rows as ApptRow[], now), total, page, pageSize };
  });
}

async function loadOwn(ctx: PatientContext, tx: TenantTx, id: string): Promise<ApptRow> {
  if (!z.string().uuid().safeParse(id).success) throw new AuthError("NOT_FOUND");
  const row = await tx.appointment.findFirst({ where: { id, ...own(ctx) }, select: apptSelect });
  // Someone else's appointment is indistinguishable from one that doesn't exist.
  if (!row) throw new AuthError("NOT_FOUND");
  return row as ApptRow;
}

export async function getMyAppointment(ctx: PatientContext, id: string, db?: TenantTx, now = new Date()): Promise<PortalAppointment> {
  return runPatientScoped(ctx, db, async (tx) => (await describe(tx, [await loadOwn(ctx, tx, id)], now))[0]);
}

/** Branches and doctors the patient can book with, in their own clinic. */
export async function getBookingOptions(ctx: PatientContext, db?: TenantTx): Promise<PortalBookingOptions> {
  return runPatientScoped(ctx, db, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { clinicId: ctx.clinicId, status: "ACTIVE" },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      select: { id: true, name: true, city: true, addressLine: true },
    });
    const doctors = await tx.doctorProfile.findMany({
      where: { clinicId: ctx.clinicId, status: "ACTIVE", branches: { some: { branchId: { in: branches.map((b) => b.id) } } } },
      select: {
        id: true, userId: true, qualifications: true, experienceYears: true, consultationFeePaise: true, onlineConsultation: true,
        specialty: { select: { name: true } }, department: { select: { name: true } }, branches: { select: { branchId: true } },
      },
    });
    const users = doctors.length ? await tx.user.findMany({ where: { id: { in: doctors.map((d) => d.userId) } }, select: { id: true, name: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const branchIds = new Set(branches.map((b) => b.id));
    return {
      clinicName: ctx.clinicName,
      branches,
      doctors: doctors
        .map((d) => ({
          id: d.id,
          name: userName.get(d.userId) ?? "Doctor",
          specialty: d.specialty?.name ?? null,
          department: d.department?.name ?? null,
          qualifications: d.qualifications,
          experienceYears: d.experienceYears,
          consultationFee: d.consultationFeePaise / 100,
          offersOnline: d.onlineConsultation,
          branchIds: d.branches.map((b) => b.branchId).filter((id) => branchIds.has(id)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      maxDaysAhead: MAX_DAYS_AHEAD,
    };
  });
}

/** Free slots for a doctor at a branch on an IST date. A hint only: booking re-checks under a lock. */
export async function getMySlots(ctx: PatientContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<{ date: string; slots: string[] }> {
  const input = slotsQuerySchema.parse(raw);
  const dayStart = slotInstant(input.date, "00:00");
  return runPatientScoped(ctx, db, async (tx) => {
    const doctor = await tx.doctorProfile.findFirst({
      where: { id: input.doctorId, clinicId: ctx.clinicId, status: "ACTIVE", branches: { some: { branchId: input.branchId, branch: { status: "ACTIVE" } } } },
      select: { id: true },
    });
    if (!doctor) throw new AuthError("NOT_FOUND");
    let busy: { starts_at: Date }[];
    try {
      busy = await tx.$queryRaw<{ starts_at: Date }[]>`
        SELECT app.patient_doctor_busy_slots(${input.doctorId}::uuid, ${dayStart}, ${new Date(dayStart.getTime() + 864e5)}) AS starts_at`;
    } catch (err) {
      mapBookingDbError(err);
    }
    return { date: input.date, slots: bookableSlots(input.date, new Set(busy.map((b) => istDayKey(b.starts_at).time)), now) };
  });
}

/**
 * Books one of the clinic's standard slots for the signed-in patient. The
 * optional symptoms are saved in the SAME transaction as a patient-reported
 * symptom report linked to the new appointment, so both happen or neither.
 */
export async function bookMyAppointment(ctx: PatientContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<PortalAppointment> {
  const input = bookingSchema.parse(raw);
  const startsAt = slotInstant(input.date, input.time);
  return runPatientScoped(ctx, db, async (tx) => {
    let id: string;
    try {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT app.patient_book_appointment(${input.doctorId}::uuid, ${input.branchId}::uuid, ${startsAt}, ${input.reason}, ${input.type.toUpperCase()})::text AS id`;
      id = row.id;
    } catch (err) {
      mapBookingDbError(err);
    }
    if (input.symptoms) {
      await submitSymptomReport(
        ctx,
        { requestId: input.symptoms.requestId, appointmentId: id, reason: input.reason, symptoms: input.symptoms.symptoms, onset: input.symptoms.onset, severity: input.symptoms.severity ?? null, notes: null },
        tx
      );
    }
    return (await describe(tx, [await loadOwn(ctx, tx, id)], now))[0];
  });
}

export async function cancelMyAppointment(ctx: PatientContext, id: string, db?: TenantTx, now = new Date()): Promise<PortalAppointment> {
  const result = await runPatientScoped(ctx, db, async (tx) => {
    const current = await loadOwn(ctx, tx, id);
    try {
      await tx.$executeRaw`SELECT app.patient_cancel_appointment(${current.id}::uuid)`;
    } catch (err) {
      mapBookingDbError(err);
    }
    return (await describe(tx, [await loadOwn(ctx, tx, id)], now))[0];
  });
  // After the cancellation is committed: an advance fee paid online is refunded.
  if (db || !result.feePaid) return result;
  await refundBookingFees(id, "Withdrawn or cancelled by the patient", { patient: ctx });
  return runPatientScoped(ctx, undefined, async (tx) => (await describe(tx, [await loadOwn(ctx, tx, id)], now))[0]);
}

export async function rescheduleMyAppointment(ctx: PatientContext, id: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<PortalAppointment> {
  const input = rescheduleSchema.parse(raw);
  const startsAt = slotInstant(input.date, input.time);
  return runPatientScoped(ctx, db, async (tx) => {
    const current = await loadOwn(ctx, tx, id);
    try {
      await tx.$executeRaw`SELECT app.patient_reschedule_appointment(${current.id}::uuid, ${startsAt})`;
    } catch (err) {
      mapBookingDbError(err);
    }
    return (await describe(tx, [await loadOwn(ctx, tx, id)], now))[0];
  });
}

type InvoiceRow = { id: string; invoiceNumber: string; issuedAt: Date; dueDate: Date | null; totalPaise: number; status: string; branchId: string; appointmentId: string | null };

async function describeInvoices(tx: TenantTx, rows: InvoiceRow[]): Promise<PortalInvoice[]> {
  if (rows.length === 0) return [];
  const payments = await tx.payment.groupBy({ by: ["invoiceId"], where: { invoiceId: { in: rows.map((r) => r.id) }, status: "SUCCEEDED" }, _sum: { amountPaise: true } });
  // Same rule as billing-math paidPaise: only SUCCEEDED payments count.
  const paid = new Map(payments.map((p) => [p.invoiceId, p._sum.amountPaise ?? 0]));
  const names = await lookupNames(tx, { branches: rows.map((r) => r.branchId) });
  const apptIds = rows.map((r) => r.appointmentId).filter((x): x is string => Boolean(x));
  const appts = apptIds.length ? await tx.appointment.findMany({ where: { id: { in: apptIds } }, select: { id: true, startsAt: true } }) : [];
  const apptDate = new Map(appts.map((a) => [a.id, istDayKey(a.startsAt).date]));
  const payOnline = onlinePaymentsConfigured();
  return rows.map((r) => {
    const paidPaise = Math.min(paid.get(r.id) ?? 0, r.totalPaise);
    return {
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      issuedAt: r.issuedAt.toISOString(),
      dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
      total: r.totalPaise / 100,
      paid: paidPaise / 100,
      balance: (r.totalPaise - paidPaise) / 100,
      status: r.status === "PAID" ? "paid" : r.status === "PARTIALLY_PAID" ? "partially_paid" : "pending",
      branchName: names.branch.get(r.branchId)?.name ?? null,
      appointmentDate: r.appointmentId ? (apptDate.get(r.appointmentId) ?? null) : null,
      canPayOnline: payOnline && (r.status === "PENDING" || r.status === "PARTIALLY_PAID") && r.totalPaise - paidPaise >= 100,
    };
  });
}

const invoiceSelect = { id: true, invoiceNumber: true, issuedAt: true, dueDate: true, totalPaise: true, status: true, branchId: true, appointmentId: true } as const;

/** The patient's own invoices (void ones are never shown). */
export async function listMyInvoices(ctx: PatientContext, raw: unknown, db?: TenantTx): Promise<Page<PortalInvoice>> {
  const input = z.object({ page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(50).optional() }).parse(raw ?? {});
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 50);
  const where = { ...own(ctx), status: { not: "VOID" as const } };
  return runPatientScoped(ctx, db, async (tx) => {
    const rows = await tx.invoice.findMany({ where, orderBy: [{ issuedAt: "desc" }, { id: "asc" }], skip, take, select: invoiceSelect });
    const total = await tx.invoice.count({ where });
    return { items: await describeInvoices(tx, rows), total, page, pageSize };
  });
}

/** The clinic record exactly as staff keep it — read-only for the patient. */
export async function getMyClinicRecord(ctx: PatientContext, db?: TenantTx): Promise<PortalClinicRecord> {
  return runPatientScoped(ctx, db, async (tx) => {
    const p = await tx.patient.findFirst({
      where: { id: { in: ctx.patientIds }, clinicId: ctx.clinicId },
      select: {
        name: true, patientNumber: true, dateOfBirth: true, gender: true, phone: true, email: true, bloodGroup: true, addressLine: true, city: true,
        allergies: true, chronicConditions: true, emergencyContactName: true, emergencyContactPhone: true, branchId: true,
      },
    });
    if (!p) throw new AuthError("NOT_FOUND");
    const names = await lookupNames(tx, { branches: [p.branchId] });
    return {
      name: p.name,
      patientNumber: p.patientNumber,
      dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
      gender: genderToUi(p.gender),
      phone: p.phone,
      email: p.email,
      bloodGroup: p.bloodGroup,
      addressLine: p.addressLine,
      city: p.city,
      allergies: p.allergies,
      chronicConditions: p.chronicConditions,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
      branchName: names.branch.get(p.branchId)?.name ?? null,
    };
  });
}

/** Everything the portal home needs, in one transaction. Only the patient's own data; no clinic-wide figures. */
export async function getPortalDashboard(ctx: PatientContext, db?: TenantTx, now = new Date()): Promise<PortalDashboard> {
  return runPatientScoped(ctx, db, async (tx) => {
    const p = await tx.patient.findFirst({
      where: { id: { in: ctx.patientIds }, clinicId: ctx.clinicId },
      select: { name: true, patientNumber: true, dateOfBirth: true, gender: true, phone: true, email: true, bloodGroup: true, branchId: true },
    });
    const upcomingRows = await tx.appointment.findMany({ where: { ...own(ctx), ...scopeFilter("upcoming", now) }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 3, select: apptSelect });
    const recentRows = await tx.appointment.findMany({ where: { ...own(ctx), ...scopeFilter("past", now) }, orderBy: [{ startsAt: "desc" }, { id: "asc" }], take: 3, select: apptSelect });
    const openWhere = { ...own(ctx), status: { in: ["PENDING", "PARTIALLY_PAID"] as ("PENDING" | "PARTIALLY_PAID")[] } };
    const openInvoices = await tx.invoice.findMany({ where: openWhere, orderBy: [{ issuedAt: "desc" }, { id: "asc" }], take: 20, select: invoiceSelect });
    const outstanding = await describeInvoices(tx, openInvoices);
    const reportCount = await tx.labReport.count({ where: eligibleReportWhere(ctx) });
    const documentCount = await tx.patientDocument.count({ where: eligibleDocumentWhere(ctx) });
    const names = p ? await lookupNames(tx, { branches: [p.branchId] }) : null;
    return {
      clinicName: ctx.clinicName,
      patient: p
        ? {
            name: p.name,
            patientNumber: p.patientNumber,
            dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
            gender: genderToUi(p.gender),
            phone: p.phone,
            email: p.email,
            bloodGroup: p.bloodGroup,
            branchName: names?.branch.get(p.branchId)?.name ?? null,
          }
        : null,
      upcoming: await describe(tx, upcomingRows as ApptRow[], now),
      recent: await describe(tx, recentRows as ApptRow[], now),
      invoices: {
        outstandingCount: outstanding.filter((i) => i.balance > 0).length,
        outstandingBalance: outstanding.reduce((sum, i) => sum + i.balance, 0),
        latest: outstanding.filter((i) => i.balance > 0).slice(0, 3),
      },
      reportCount,
      documentCount,
    };
  });
}

/** The patient's own clinic's public contact details (for Account Settings → Contact your clinic). */
export async function getMyClinicContact(ctx: PatientContext, db?: TenantTx): Promise<PortalClinicContact> {
  return runPatientScoped(ctx, db, async (tx) => {
    const clinic = await tx.clinic.findFirst({
      where: { id: ctx.clinicId },
      select: { name: true, email: true, phone: true, addressLine: true, city: true, state: true, pincode: true },
    });
    if (!clinic) throw new AuthError("NOT_FOUND");
    return clinic;
  });
}

import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { appointmentScopeFilter, assertRecordAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { istDayKey } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { Prisma } from "@/generated/prisma/client";
import type { ConsultationWithNames, PrescriptionWithNames } from "@/services/clinical";
import type { TimelineEvent } from "@/types";
import { ageFrom, avatarColorFor, genderToUi } from "./mappers";
import { cleanVitals, formatDuration, vitalsSchema, vitalsToUi } from "./clinical-rules";
import { pageArgs, runScoped, type Page } from "./scope";

// Consultations and prescriptions. Reading needs a clinical permission
// (front-desk roles have none, so they never see clinical notes) and follows
// the appointment's visibility: clinic-wide for administrators, own
// appointments for doctors, the user's branch if restricted. WRITING is
// limited to the doctor the appointment is assigned to — administrators can
// read but not author (migration 20261016000000 enforces the same in RLS).
// Nothing here invents clinical content; empty fields stay empty.

export const CLINICAL_VIEW = ["medical_record.view", "patient.medical_record.view", "medical_record.manage"] as const;
const CONSULT_WRITE = ["medical_notes.create", "medical_notes.update", "medical_record.manage", "patient.medical_record.update"] as const;
export const RX_VIEW = ["prescription.view", "prescription.manage", "prescription.create"] as const;
export const RX_CREATE = ["prescription.create", "prescription.manage"] as const;
const BILLING_VIEW = ["billing.view", "invoice.view", "billing.manage"] as const;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Only the doctor assigned to the appointment may author its clinical record. */
function assertAssignedDoctor(ctx: TenantContext, appointmentDoctorId: string) {
  if (!ctx.doctorId || ctx.doctorId !== appointmentDoctorId) throw new AuthError("FORBIDDEN");
}

/** Appointment filter every clinical query starts from: branch restriction + doctor scope. */
function appointmentScope(ctx: TenantContext, extra: { patientId?: string; doctorId?: string } = {}) {
  return {
    clinicId: ctx.clinicId,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    ...appointmentScopeFilter(ctx),
    ...(extra.patientId ? { patientId: extra.patientId } : {}),
    // A doctor-scoped user can't widen their scope by asking for another doctor.
    ...(extra.doctorId && extra.doctorId !== "all" && ctx.careScope === "clinic" ? { doctorId: extra.doctorId } : {}),
  };
}

async function namesFor(tx: TenantTx, patientIds: string[], doctorIds: string[]) {
  const [patients, doctors] = await Promise.all([
    patientIds.length ? tx.patient.findMany({ where: { id: { in: [...new Set(patientIds)] } }, select: { id: true, name: true } }) : [],
    doctorIds.length ? tx.doctorProfile.findMany({ where: { id: { in: [...new Set(doctorIds)] } }, select: { id: true, user: { select: { name: true } } } }) : [],
  ]);
  return { patient: new Map(patients.map((p) => [p.id, p.name])), doctor: new Map(doctors.map((d) => [d.id, d.user.name])) };
}

// --- consultations -------------------------------------------------------------

const consultSelect = {
  id: true, clinicId: true, appointmentId: true, chiefComplaint: true, notes: true, diagnosis: true, symptoms: true, history: true,
  allergiesNoted: true, vitals: true, examination: true, treatmentPlan: true, labTestsOrdered: true, followUpDate: true, status: true, createdAt: true,
  appointment: { select: { patientId: true, doctorId: true, branchId: true, startsAt: true, status: true } },
  prescriptions: { select: { id: true }, orderBy: { issuedAt: "desc" as const }, take: 1 },
} as const;

type ConsultRow = {
  id: string; clinicId: string; appointmentId: string; chiefComplaint: string; notes: string | null; diagnosis: string[]; symptoms: string[];
  history: string | null; allergiesNoted: string[]; vitals: unknown; examination: string | null; treatmentPlan: string | null;
  labTestsOrdered: string[]; followUpDate: Date | null; status: "IN_PROGRESS" | "COMPLETED"; createdAt: Date;
  appointment: { patientId: string; doctorId: string; branchId: string; startsAt: Date; status: string };
  prescriptions: { id: string }[];
};

function toUiConsultation(ctx: TenantContext, r: ConsultRow, names: { patient: Map<string, string>; doctor: Map<string, string> }): ConsultationWithNames {
  const assigned = ctx.doctorId !== null && ctx.doctorId === r.appointment.doctorId;
  return {
    id: r.id,
    appointmentId: r.appointmentId,
    patientId: r.appointment.patientId,
    doctorId: r.appointment.doctorId,
    branchId: r.appointment.branchId,
    date: istDayKey(r.appointment.startsAt).date,
    chiefComplaint: r.chiefComplaint,
    symptoms: r.symptoms,
    history: r.history ?? undefined,
    allergiesNoted: r.allergiesNoted,
    vitals: vitalsToUi(r.vitals),
    examination: r.examination ?? undefined,
    diagnosis: r.diagnosis,
    clinicalNotes: r.notes ?? "",
    treatmentPlan: r.treatmentPlan ?? undefined,
    labTestsOrdered: r.labTestsOrdered,
    followUpDate: r.followUpDate ? r.followUpDate.toISOString().slice(0, 10) : undefined,
    prescriptionId: r.prescriptions[0]?.id,
    status: r.status === "COMPLETED" ? "completed" : "in_progress",
    patientName: names.patient.get(r.appointment.patientId) ?? "—",
    doctorName: names.doctor.get(r.appointment.doctorId) ?? "—",
    capabilities: {
      edit: assigned && r.status === "IN_PROGRESS" && hasAnyPermission(ctx, CONSULT_WRITE),
      prescribe: assigned && hasAnyPermission(ctx, RX_CREATE),
    },
  };
}

export const listConsultationsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  doctorId: z.string().optional(),
  patientId: uuid.optional(),
  status: z.enum(["in_progress", "completed", "all"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listConsultations(ctx: TenantContext, input: z.infer<typeof listConsultationsSchema>, db?: TenantTx): Promise<Page<ConsultationWithNames>> {
  requirePermission(ctx, CLINICAL_VIEW);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    appointment: appointmentScope(ctx, { patientId: input.patientId, doctorId: input.doctorId }),
    ...(input.status && input.status !== "all" ? { status: input.status === "completed" ? ("COMPLETED" as const) : ("IN_PROGRESS" as const) } : {}),
    ...(search
      ? {
          OR: [
            { chiefComplaint: { contains: search, mode: "insensitive" as const } },
            { appointment: { patient: { name: { contains: search, mode: "insensitive" as const } } } },
            { appointment: { doctor: { user: { name: { contains: search, mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.consultation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take, select: consultSelect }),
      tx.consultation.count({ where }),
    ]);
    const typed = rows as ConsultRow[];
    const names = await namesFor(tx, typed.map((r) => r.appointment.patientId), typed.map((r) => r.appointment.doctorId));
    return { items: typed.map((r) => toUiConsultation(ctx, r, names)), total, page, pageSize };
  });
}

async function loadConsultation(ctx: TenantContext, tx: TenantTx, id: string): Promise<ConsultRow> {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const row = (await tx.consultation.findFirst({ where: { id, clinicId: ctx.clinicId, appointment: appointmentScope(ctx) }, select: consultSelect })) as ConsultRow | null;
  assertRecordAccess(ctx, row ? { clinicId: row.clinicId, branchId: row.appointment.branchId } : null);
  return row!;
}

async function consultationDetail(ctx: TenantContext, tx: TenantTx, row: ConsultRow, now = new Date()): Promise<ConsultationWithNames> {
  const [names, patient] = await Promise.all([
    namesFor(tx, [row.appointment.patientId], [row.appointment.doctorId]),
    tx.patient.findFirst({ where: { id: row.appointment.patientId }, select: { patientNumber: true, dateOfBirth: true, gender: true } }),
  ]);
  return {
    ...toUiConsultation(ctx, row, names),
    patientNumber: patient?.patientNumber,
    patientAge: patient ? ageFrom(patient.dateOfBirth, now) : undefined,
    patientGender: patient ? genderToUi(patient.gender) : undefined,
    patientAvatarColor: avatarColorFor(row.appointment.patientId),
  };
}

export async function getConsultation(ctx: TenantContext, id: string, db?: TenantTx): Promise<ConsultationWithNames> {
  requirePermission(ctx, CLINICAL_VIEW);
  return runScoped(ctx, db, async (tx) => consultationDetail(ctx, tx, await loadConsultation(ctx, tx, id)));
}

/**
 * Starts the consultation for a checked-in appointment (assigned doctor only)
 * and moves the appointment to IN_CONSULTATION. Starting again returns the
 * existing consultation.
 */
export async function startConsultation(ctx: TenantContext, appointmentId: string, db?: TenantTx): Promise<ConsultationWithNames> {
  requirePermission(ctx, CONSULT_WRITE);
  if (!uuid.safeParse(appointmentId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consultation:${appointmentId}`}))`;
    const appt = assertRecordAccess(
      ctx,
      await tx.appointment.findFirst({
        where: { id: appointmentId, ...appointmentScope(ctx) },
        select: { id: true, clinicId: true, branchId: true, doctorId: true, status: true, reason: true },
      })
    );
    assertAssignedDoctor(ctx, appt.doctorId);
    const existing = await tx.consultation.findFirst({ where: { clinicId: ctx.clinicId, appointmentId }, select: { id: true } });
    if (existing) return consultationDetail(ctx, tx, await loadConsultation(ctx, tx, existing.id));
    if (appt.status !== "CHECKED_IN") throw new DataError("INVALID_TRANSITION", "Check the patient in before starting the consultation.");

    const moved = await tx.appointment.updateMany({ where: { id: appointmentId, clinicId: ctx.clinicId, status: "CHECKED_IN" }, data: { status: "IN_CONSULTATION" } });
    if (moved.count !== 1) throw new DataError("INVALID_TRANSITION", "This appointment was just changed by someone else. Refresh and try again.");
    // The visit reason entered at booking is the starting chief complaint; the doctor edits it.
    const created = await tx.consultation.create({ data: { clinicId: ctx.clinicId, appointmentId, chiefComplaint: appt.reason, status: "IN_PROGRESS" }, select: { id: true } });
    return consultationDetail(ctx, tx, await loadConsultation(ctx, tx, created.id));
  });
}

const tags = z.array(z.string().trim().min(1).max(100)).max(30);
const longText = (max: number) => z.string().trim().max(max);

export const consultationPatchSchema = z
  .object({
    chiefComplaint: z.string().trim().min(2).max(300),
    symptoms: tags,
    history: longText(4000),
    allergiesNoted: tags,
    vitals: vitalsSchema,
    examination: longText(4000),
    diagnosis: tags,
    clinicalNotes: longText(8000),
    treatmentPlan: longText(4000),
    labTestsOrdered: tags,
    followUpDate: isoDate.nullable(),
  })
  .partial()
  .strict();

function patchData(input: z.infer<typeof consultationPatchSchema>, visitDate: string) {
  if (input.followUpDate && input.followUpDate < visitDate) throw new DataError("INVALID_INPUT", "The follow-up date can't be before the visit.");
  const blank = (s: string | undefined) => (s === undefined ? undefined : s || null);
  return {
    ...(input.chiefComplaint !== undefined && { chiefComplaint: input.chiefComplaint }),
    ...(input.symptoms !== undefined && { symptoms: input.symptoms }),
    ...(input.history !== undefined && { history: blank(input.history) }),
    ...(input.allergiesNoted !== undefined && { allergiesNoted: input.allergiesNoted }),
    ...(input.vitals !== undefined && { vitals: cleanVitals(input.vitals) }),
    ...(input.examination !== undefined && { examination: blank(input.examination) }),
    ...(input.diagnosis !== undefined && { diagnosis: input.diagnosis }),
    ...(input.clinicalNotes !== undefined && { notes: blank(input.clinicalNotes) }),
    ...(input.treatmentPlan !== undefined && { treatmentPlan: blank(input.treatmentPlan) }),
    ...(input.labTestsOrdered !== undefined && { labTestsOrdered: input.labTestsOrdered }),
    ...(input.followUpDate !== undefined && { followUpDate: input.followUpDate ? new Date(`${input.followUpDate}T00:00:00Z`) : null }),
  };
}

/** Saves a draft (assigned doctor, in-progress consultations only). */
export async function updateConsultation(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<ConsultationWithNames> {
  requirePermission(ctx, CONSULT_WRITE);
  const input = consultationPatchSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const row = await loadConsultation(ctx, tx, id);
    assertAssignedDoctor(ctx, row.appointment.doctorId);
    if (row.status !== "IN_PROGRESS") throw new DataError("INVALID_TRANSITION", "A completed consultation can't be edited.");
    const changed = await tx.consultation.updateMany({ where: { id, clinicId: ctx.clinicId, status: "IN_PROGRESS" }, data: patchData(input, istDayKey(row.appointment.startsAt).date) });
    if (changed.count !== 1) throw new DataError("INVALID_TRANSITION", "This consultation was just completed. Refresh to see it.");
    return consultationDetail(ctx, tx, await loadConsultation(ctx, tx, id));
  });
}

/** Saves the final notes, completes the consultation and its appointment. */
export async function completeConsultation(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<ConsultationWithNames> {
  requirePermission(ctx, CONSULT_WRITE);
  const input = consultationPatchSchema.parse(raw ?? {});
  return runScoped(ctx, db, async (tx) => {
    const row = await loadConsultation(ctx, tx, id);
    assertAssignedDoctor(ctx, row.appointment.doctorId);
    if (row.status !== "IN_PROGRESS") throw new DataError("INVALID_TRANSITION", "This consultation is already completed.");
    const changed = await tx.consultation.updateMany({
      where: { id, clinicId: ctx.clinicId, status: "IN_PROGRESS" },
      data: { ...patchData(input, istDayKey(row.appointment.startsAt).date), status: "COMPLETED", completedAt: now },
    });
    if (changed.count !== 1) throw new DataError("INVALID_TRANSITION", "This consultation was just completed. Refresh to see it.");
    await tx.appointment.updateMany({ where: { id: row.appointmentId, clinicId: ctx.clinicId, status: { in: ["IN_CONSULTATION", "CHECKED_IN"] } }, data: { status: "COMPLETED" } });
    return consultationDetail(ctx, tx, await loadConsultation(ctx, tx, id));
  });
}

// --- prescriptions ---------------------------------------------------------------

// No position column, so entry order isn't stored; medicine name gives a stable order.
const RX_ITEM_ORDER: Prisma.PrescriptionItemOrderByWithRelationInput[] = [{ medicine: { name: "asc" } }, { id: "asc" }];

const rxSelect = {
  id: true, clinicId: true, consultationId: true, prescriptionNumber: true, status: true, notes: true, issuedAt: true,
  items: {
    select: { dosage: true, frequency: true, durationDays: true, instructions: true, route: true, medicine: { select: { name: true, strength: true } } },
    orderBy: RX_ITEM_ORDER,
  },
  consultation: { select: { appointment: { select: { patientId: true, doctorId: true, branchId: true } } } },
} as const;

type RxRow = {
  id: string; clinicId: string; consultationId: string; prescriptionNumber: string; status: "ACTIVE" | "COMPLETED" | "CANCELLED"; notes: string | null; issuedAt: Date;
  items: { dosage: string; frequency: string; durationDays: number; instructions: string | null; route: string | null; medicine: { name: string; strength: string } }[];
  consultation: { appointment: { patientId: string; doctorId: string; branchId: string } };
};

function toUiPrescription(r: RxRow, names: { patient: Map<string, string>; doctor: Map<string, string> }): PrescriptionWithNames {
  const a = r.consultation.appointment;
  return {
    id: r.id,
    prescriptionNumber: r.prescriptionNumber,
    patientId: a.patientId,
    doctorId: a.doctorId,
    consultationId: r.consultationId,
    date: istDayKey(r.issuedAt).date,
    items: r.items.map((i) => ({
      medicineName: i.medicine.name,
      strength: i.medicine.strength,
      dosage: i.dosage,
      frequency: i.frequency,
      duration: formatDuration(i.durationDays),
      route: i.route ?? "",
      instructions: i.instructions ?? undefined,
    })),
    notes: r.notes ?? undefined,
    status: r.status.toLowerCase() as PrescriptionWithNames["status"],
    aiReviewFlags: [], // no AI review runs on clinic-database prescriptions
    patientName: names.patient.get(a.patientId) ?? "—",
    doctorName: names.doctor.get(a.doctorId) ?? "—",
  };
}

export const listPrescriptionsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  doctorId: z.string().optional(),
  patientId: uuid.optional(),
  status: z.enum(["active", "completed", "cancelled", "all"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listPrescriptions(ctx: TenantContext, input: z.infer<typeof listPrescriptionsSchema>, db?: TenantTx): Promise<Page<PrescriptionWithNames>> {
  requirePermission(ctx, RX_VIEW);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    consultation: { appointment: appointmentScope(ctx, { patientId: input.patientId, doctorId: input.doctorId }) },
    ...(input.status && input.status !== "all" ? { status: input.status.toUpperCase() as RxRow["status"] } : {}),
    ...(search
      ? {
          OR: [
            { prescriptionNumber: { contains: search, mode: "insensitive" as const } },
            { consultation: { appointment: { patient: { name: { contains: search, mode: "insensitive" as const } } } } },
            { consultation: { appointment: { doctor: { user: { name: { contains: search, mode: "insensitive" as const } } } } } },
          ],
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.prescription.findMany({ where, orderBy: [{ issuedAt: "desc" }, { prescriptionNumber: "desc" }], skip, take, select: rxSelect }),
      tx.prescription.count({ where }),
    ]);
    const typed = rows as RxRow[];
    const names = await namesFor(tx, typed.map((r) => r.consultation.appointment.patientId), typed.map((r) => r.consultation.appointment.doctorId));
    return { items: typed.map((r) => toUiPrescription(r, names)), total, page, pageSize };
  });
}

async function loadPrescription(ctx: TenantContext, tx: TenantTx, id: string): Promise<RxRow> {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const row = (await tx.prescription.findFirst({ where: { id, clinicId: ctx.clinicId, consultation: { appointment: appointmentScope(ctx) } }, select: rxSelect })) as RxRow | null;
  assertRecordAccess(ctx, row ? { clinicId: row.clinicId, branchId: row.consultation.appointment.branchId } : null);
  return row!;
}

async function prescriptionDetail(ctx: TenantContext, tx: TenantTx, row: RxRow, now = new Date()): Promise<PrescriptionWithNames> {
  const a = row.consultation.appointment;
  const [names, patient, doctor, branch] = await Promise.all([
    namesFor(tx, [a.patientId], [a.doctorId]),
    tx.patient.findFirst({ where: { id: a.patientId }, select: { patientNumber: true, dateOfBirth: true, gender: true, allergies: true } }),
    tx.doctorProfile.findFirst({ where: { id: a.doctorId }, select: { qualifications: true, registrationNumber: true } }),
    tx.branch.findFirst({ where: { id: a.branchId, clinicId: ctx.clinicId }, select: { name: true, addressLine: true, city: true, phone: true } }),
  ]);
  return {
    ...toUiPrescription(row, names),
    patientNumber: patient?.patientNumber,
    patientAge: patient ? ageFrom(patient.dateOfBirth, now) : undefined,
    patientGender: patient ? genderToUi(patient.gender) : undefined,
    patientAllergies: patient?.allergies ?? [],
    doctorQualifications: doctor?.qualifications,
    doctorRegistration: doctor?.registrationNumber,
    branchName: branch?.name,
    branchAddress: branch ? `${branch.addressLine}, ${branch.city}` : undefined,
    branchPhone: branch?.phone,
  };
}

export async function getPrescription(ctx: TenantContext, id: string, db?: TenantTx): Promise<PrescriptionWithNames> {
  requirePermission(ctx, RX_VIEW);
  return runScoped(ctx, db, async (tx) => prescriptionDetail(ctx, tx, await loadPrescription(ctx, tx, id)));
}

export const createPrescriptionSchema = z
  .object({
    consultationId: uuid,
    items: z
      .array(
        z
          .object({
            medicineId: uuid,
            dosage: z.string().trim().min(1).max(100),
            frequency: z.string().trim().min(1).max(100),
            durationDays: z.number().int().min(1).max(365),
            route: z.string().trim().max(40).optional(),
            instructions: z.string().trim().max(300).optional(),
          })
          .strict()
      )
      .min(1)
      .max(20),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

/** Issues a prescription for a consultation (assigned doctor only), numbered clinic-wide. */
export async function createPrescription(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<PrescriptionWithNames> {
  requirePermission(ctx, RX_CREATE);
  const input = createPrescriptionSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const consultation = await loadConsultation(ctx, tx, input.consultationId);
    assertAssignedDoctor(ctx, consultation.appointment.doctorId);
    const medicineIds = [...new Set(input.items.map((i) => i.medicineId))];
    const found = await tx.medicine.count({ where: { id: { in: medicineIds }, isActive: true } });
    if (found !== medicineIds.length) throw new DataError("INVALID_INPUT", "Choose each medicine from the catalogue.");

    const [{ n: prescriptionNumber }] = await tx.$queryRaw<{ n: string }[]>`SELECT app.next_document_number('prescription') AS n`;
    const created = await tx.prescription.create({
      data: {
        clinicId: ctx.clinicId,
        consultationId: consultation.id,
        prescriptionNumber,
        status: "ACTIVE",
        notes: input.notes || null,
        issuedAt: now,
        items: {
          create: input.items.map((i) => ({
            medicineId: i.medicineId,
            dosage: i.dosage,
            frequency: i.frequency,
            durationDays: i.durationDays,
            route: i.route || null,
            instructions: i.instructions || null,
          })),
        },
      },
      select: { id: true },
    });
    return prescriptionDetail(ctx, tx, await loadPrescription(ctx, tx, created.id), now);
  });
}

// --- patient timeline ----------------------------------------------------------------

/**
 * A patient's history — consultations, prescriptions and invoices, each only
 * for users permitted to see it (appointments have their own tab). Every source applies the same
 * branch and doctor scope (and RLS), so the timeline never shows more than the
 * corresponding pages would.
 */
export async function getPatientTimeline(ctx: TenantContext, patientId: string, db?: TenantTx): Promise<TimelineEvent[]> {
  if (!uuid.safeParse(patientId).success) throw new AuthError("NOT_FOUND");
  const canClinical = hasAnyPermission(ctx, CLINICAL_VIEW);
  const canRx = hasAnyPermission(ctx, RX_VIEW);
  // Only clinical sources follow appointment scope; a billing-only user has none and still sees invoices.
  const scope = canClinical || canRx ? appointmentScope(ctx, { patientId }) : null;
  const canBilling = hasAnyPermission(ctx, BILLING_VIEW);
  return runScoped(ctx, db, async (tx) => {
    const [consults, rxs, invoices] = await Promise.all([
      canClinical && scope
        ? tx.consultation.findMany({ where: { clinicId: ctx.clinicId, appointment: scope }, take: 100, select: { id: true, status: true, chiefComplaint: true, appointment: { select: { startsAt: true, doctorId: true } } } })
        : [],
      canRx && scope
        ? tx.prescription.findMany({ where: { clinicId: ctx.clinicId, consultation: { appointment: scope } }, take: 100, select: { id: true, prescriptionNumber: true, issuedAt: true, _count: { select: { items: true } } } })
        : [],
      canBilling
        ? tx.invoice.findMany({ where: { clinicId: ctx.clinicId, patientId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }, take: 100, select: { id: true, invoiceNumber: true, issuedAt: true, status: true, totalPaise: true } })
        : [],
    ]);
    const doctorNames = (await namesFor(tx, [], consults.map((c) => c.appointment.doctorId))).doctor;
    const day = (d: Date) => istDayKey(d).date;
    const events: TimelineEvent[] = [
      ...consults.map((c) => ({
        id: `consult-${c.id}`, patientId, date: day(c.appointment.startsAt), type: "consultation" as const,
        title: c.status === "COMPLETED" ? "Consultation completed" : "Consultation in progress",
        subtitle: [doctorNames.get(c.appointment.doctorId), c.chiefComplaint].filter(Boolean).join(" · "),
        refId: c.id, href: `/consultations/${c.id}`,
      })),
      ...rxs.map((r) => ({
        id: `rx-${r.id}`, patientId, date: day(r.issuedAt), type: "prescription" as const,
        title: `Prescription ${r.prescriptionNumber}`, subtitle: `${r._count.items} item(s)`,
        refId: r.id, href: `/prescriptions/${r.id}`,
      })),
      ...invoices.map((i) => ({
        id: `inv-${i.id}`, patientId, date: day(i.issuedAt), type: "invoice" as const,
        title: `Invoice ${i.invoiceNumber}`, subtitle: `₹${(i.totalPaise / 100).toLocaleString("en-IN")} · ${i.status.toLowerCase().replace("_", " ")}`,
        refId: i.id, href: `/billing/${i.id}`,
      })),
    ];
    return events.sort((x, y) => y.date.localeCompare(x.date));
  });
}

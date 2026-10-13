import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { assertBranchAccess, assertRecordAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { istDayKey } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { Patient } from "@/types";
import { genderFromUi, toUiPatient, type DbPatientRow } from "./mappers";
import { pageArgs, runScoped, type Page } from "./scope";

// Patients — clinic-scoped. Visibility: patient.view / patient.basic_info.view
// see the clinic's patients; a doctor holding only assigned_patients.view sees
// patients they have an appointment with. RLS enforces the same independently.

export const PATIENT_VIEW = ["patient.view", "patient.basic_info.view", "assigned_patients.view"] as const;
const OPEN_STATUSES = ["SCHEDULED", "CONFIRMED"] as const;

const patientSelect = {
  id: true, clinicId: true, branchId: true, patientNumber: true, name: true, dateOfBirth: true, gender: true, phone: true,
  email: true, bloodGroup: true, addressLine: true, city: true, allergies: true, chronicConditions: true,
  emergencyContactName: true, emergencyContactPhone: true, status: true, createdAt: true,
} as const;

/** Explicit visibility filter (defence in depth alongside RLS). */
function visibilityWhere(ctx: TenantContext) {
  if (hasAnyPermission(ctx, ["patient.view", "patient.basic_info.view"])) return { clinicId: ctx.clinicId };
  if (hasAnyPermission(ctx, ["assigned_patients.view"]) && ctx.doctorId) {
    return { clinicId: ctx.clinicId, appointments: { some: { doctorId: ctx.doctorId } } };
  }
  throw new AuthError("FORBIDDEN");
}

/** lastVisit (latest completed appointment) and next open appointment, for a set of patients. */
async function visitFacts(tx: TenantTx, ids: string[], now: Date) {
  if (ids.length === 0) return new Map<string, { lastVisit?: string; nextAppointmentId?: string }>();
  const [completed, upcoming] = await Promise.all([
    tx.appointment.groupBy({ by: ["patientId"], where: { patientId: { in: ids }, status: "COMPLETED" }, _max: { startsAt: true } }),
    tx.appointment.findMany({
      where: { patientId: { in: ids }, status: { in: [...OPEN_STATUSES] }, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      select: { id: true, patientId: true },
    }),
  ]);
  const facts = new Map<string, { lastVisit?: string; nextAppointmentId?: string }>();
  for (const c of completed) if (c._max.startsAt) facts.set(c.patientId, { lastVisit: istDayKey(c._max.startsAt).date });
  for (const u of upcoming) {
    const f = facts.get(u.patientId) ?? {};
    if (!f.nextAppointmentId) facts.set(u.patientId, { ...f, nextAppointmentId: u.id });
  }
  return facts;
}

export const listPatientsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "inactive", "archived", "all"]).optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  sortBy: z.enum(["name", "lastVisit", "registeredDate"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export async function listPatients(ctx: TenantContext, input: z.infer<typeof listPatientsSchema>, db?: TenantTx, now = new Date()): Promise<Page<Patient>> {
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const search = input.search?.trim();
  const where = {
    ...visibilityWhere(ctx),
    ...(input.status && input.status !== "all" ? { status: input.status.toUpperCase() as DbPatientRow["status"] } : {}),
    ...(input.branchId && input.branchId !== "all" ? { branchId: input.branchId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { patientNumber: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  // lastVisit isn't a column; sort by registration date as the closest stored ordering.
  const dir = input.sortDir ?? "asc";
  const orderBy = input.sortBy === "name" || !input.sortBy ? [{ name: dir }, { id: "asc" as const }] : [{ createdAt: dir }, { id: "asc" as const }];

  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([tx.patient.findMany({ where, orderBy, skip, take, select: patientSelect }), tx.patient.count({ where })]);
    const facts = await visitFacts(tx, rows.map((r) => r.id), now);
    return { items: rows.map((r) => toUiPatient(r, facts.get(r.id), now)), total, page, pageSize };
  });
}

export async function getPatient(ctx: TenantContext, id: string, db?: TenantTx, now = new Date()): Promise<Patient> {
  if (!z.string().uuid().safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    const row = assertRecordAccess({ ...ctx, branchId: null }, await tx.patient.findFirst({ where: { id, ...visibilityWhere(ctx) }, select: patientSelect }));
    const facts = await visitFacts(tx, [row.id], now);
    return toUiPatient(row, facts.get(row.id), now);
  });
}

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().transform((v) => (v ? v : undefined));

export const createPatientSchema = z.object({
  name: text(120).min(2),
  age: z.coerce.number().int().min(0).max(130),
  gender: z.enum(["male", "female", "other"]),
  phone: text(30).min(5),
  email: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
  bloodGroup: optionalText(10),
  address: optionalText(300),
  city: optionalText(100),
  branchId: z.string().uuid(),
  allergies: z.array(text(100).min(1)).max(30).optional(),
  chronicConditions: z.array(text(100).min(1)).max(30).optional(),
});

async function nextPatientNumber(tx: TenantTx, clinicId: string): Promise<string> {
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { code: true } });
  const prefix = `${clinic.code}-P-`;
  const last = await tx.patient.findFirst({ where: { clinicId, patientNumber: { startsWith: prefix } }, orderBy: { patientNumber: "desc" }, select: { patientNumber: true } });
  const n = last ? Number(last.patientNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, "0")}`;
}

export async function createPatient(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<Patient> {
  requirePermission(ctx, "patient.create");
  const input = createPatientSchema.parse(raw);
  assertBranchAccess(ctx, input.branchId);
  return runScoped(ctx, db, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, clinicId: ctx.clinicId, status: "ACTIVE" }, select: { id: true } });
    if (!branch) throw new DataError("INVALID_INPUT", "Choose an active branch of your clinic.");
    // The form collects age, not a birth date: store an approximate DOB (today minus age), as the app always has.
    const dob = new Date(Date.UTC(now.getUTCFullYear() - input.age, now.getUTCMonth(), now.getUTCDate()));
    // Serialise numbering per clinic so two receptionists can't take the same number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient-number:${ctx.clinicId}`}))`;
    const row = await tx.patient.create({
      data: {
        clinicId: ctx.clinicId,
        branchId: input.branchId,
        patientNumber: await nextPatientNumber(tx, ctx.clinicId),
        name: input.name,
        dateOfBirth: dob,
        gender: genderFromUi(input.gender),
        phone: input.phone,
        email: input.email || null,
        bloodGroup: input.bloodGroup && input.bloodGroup !== "Unknown" ? input.bloodGroup : null,
        addressLine: input.address ?? null,
        city: input.city ?? null,
        allergies: input.allergies ?? [],
        chronicConditions: input.chronicConditions ?? [],
        status: "ACTIVE",
      },
      select: patientSelect,
    });
    return toUiPatient(row, {}, now);
  });
}

const BASIC_FIELDS = ["name", "phone", "email", "address", "city", "emergencyContact"] as const;

export const updatePatientSchema = z
  .object({
    name: text(120).min(2),
    phone: text(30).min(5),
    email: z.union([z.literal(""), z.string().trim().email().max(320)]),
    address: text(300),
    city: text(100),
    bloodGroup: text(10),
    allergies: z.array(text(100).min(1)).max(30),
    chronicConditions: z.array(text(100).min(1)).max(30),
    status: z.enum(["active", "inactive", "archived"]),
    emergencyContact: z.object({ name: text(120), phone: text(30), relation: text(60).optional() }),
  })
  .partial()
  .strict();

export async function updatePatient(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<Patient> {
  const patch = updatePatientSchema.parse(raw);
  const fields = Object.keys(patch);
  if (fields.length === 0) throw new DataError("INVALID_INPUT", "Nothing to update.");
  // Full edits need patient.update; patient.update_basic_info may change contact details only.
  if (!hasAnyPermission(ctx, ["patient.update"])) {
    requirePermission(ctx, "patient.update_basic_info");
    if (fields.some((f) => !(BASIC_FIELDS as readonly string[]).includes(f))) throw new AuthError("FORBIDDEN");
  }
  await getPatient(ctx, id, db, now); // existence + visibility (NOT_FOUND otherwise)
  return runScoped(ctx, db, async (tx) => {
    const row = await tx.patient.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(patch.email !== undefined && { email: patch.email || null }),
        ...(patch.address !== undefined && { addressLine: patch.address || null }),
        ...(patch.city !== undefined && { city: patch.city || null }),
        ...(patch.bloodGroup !== undefined && { bloodGroup: patch.bloodGroup && patch.bloodGroup !== "Unknown" ? patch.bloodGroup : null }),
        ...(patch.allergies !== undefined && { allergies: patch.allergies }),
        ...(patch.chronicConditions !== undefined && { chronicConditions: patch.chronicConditions }),
        ...(patch.status !== undefined && { status: patch.status.toUpperCase() as DbPatientRow["status"] }),
        ...(patch.emergencyContact !== undefined && {
          emergencyContactName: patch.emergencyContact.name || null,
          emergencyContactPhone: patch.emergencyContact.phone || null,
        }),
      },
      select: patientSelect,
    });
    if (row.clinicId !== ctx.clinicId) throw new AuthError("NOT_FOUND");
    const facts = await visitFacts(tx, [row.id], now);
    return toUiPatient(row, facts.get(row.id), now);
  });
}

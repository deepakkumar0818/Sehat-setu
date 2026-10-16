import "server-only";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { ClinicProfile, DepartmentPage, LiveDepartment, LiveSpecialty } from "@/lib/live-types";
import type { Branch } from "@/types";
import {
  branchCodeFromName,
  branchInputSchema,
  branchPatchSchema,
  clinicProfileSchema,
  departmentInputSchema,
  departmentPatchSchema,
  isUuid,
  nextFreeCode,
} from "./clinic-admin-rules";
import { runScoped } from "./scope";

// Clinic setup for administrators: branches, departments, the specialty
// catalogue (read-only here) and the clinic profile. Every write is also
// checked by RLS (branches_*, departments_*, clinics_update policies) and
// audited by row-change triggers.

export const BRANCH_CREATE = ["branch.create"] as const;
export const BRANCH_UPDATE = ["branch.update"] as const;
export const DEPARTMENT_MANAGE = ["clinic.settings.manage", "branch.update"] as const;
export const CLINIC_EDIT = ["clinic.update", "clinic.settings.manage"] as const;

type BranchRow = { id: string; clinicId: string; name: string; code: string; city: string; addressLine: string; phone: string; email: string | null; isHeadOffice: boolean; status: "ACTIVE" | "INACTIVE" };

const toBranch = (b: BranchRow): Branch => ({
  id: b.id,
  clinicId: b.clinicId,
  name: b.name,
  code: b.code,
  city: b.city,
  address: b.addressLine,
  phone: b.phone,
  email: b.email ?? undefined,
  isHeadOffice: b.isHeadOffice,
  status: b.status === "ACTIVE" ? "active" : "inactive",
});

const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

// --- Branches ------------------------------------------------------------------

export async function createBranch(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<Branch> {
  requirePermission(ctx, BRANCH_CREATE);
  // A branch-restricted member manages only their own branch.
  if (ctx.branchId) throw new AuthError("FORBIDDEN");
  const input = branchInputSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const existing = await tx.branch.findMany({ where: { clinicId: ctx.clinicId }, select: { code: true, name: true } });
    if (existing.some((b) => b.name.trim().toLowerCase() === input.name.toLowerCase())) {
      throw new DataError("DUPLICATE", `There's already a branch called ${input.name}.`);
    }
    const taken = new Set(existing.map((b) => b.code.toUpperCase()));
    if (input.code && taken.has(input.code)) throw new DataError("DUPLICATE", `Branch code ${input.code} is already used.`);
    const code = input.code ?? nextFreeCode(branchCodeFromName(input.name), taken);
    try {
      const row = await tx.branch.create({
        data: {
          clinicId: ctx.clinicId,
          code,
          name: input.name,
          city: input.city,
          addressLine: input.address,
          phone: input.phone,
          email: input.email,
          isHeadOffice: existing.length === 0,
        },
      });
      return toBranch(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DataError("DUPLICATE", `Branch code ${code} is already used.`);
      throw err;
    }
  });
}

export async function updateBranch(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<Branch> {
  requirePermission(ctx, BRANCH_UPDATE);
  if (!isUuid(id)) throw new AuthError("NOT_FOUND");
  const patch = branchPatchSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id, clinicId: ctx.clinicId } });
    if (!branch || (ctx.branchId && ctx.branchId !== id)) throw new AuthError("NOT_FOUND");

    if ("status" in patch) {
      const status = patch.status === "active" ? "ACTIVE" : "INACTIVE";
      if (status === branch.status) return toBranch(branch);
      if (status === "INACTIVE") {
        if (branch.isHeadOffice) throw new DataError("INVALID_TRANSITION", "The head office can't be deactivated.");
        const upcoming = await tx.appointment.count({
          where: { clinicId: ctx.clinicId, branchId: id, startsAt: { gte: new Date() }, status: { in: ["PENDING_APPROVAL", "SCHEDULED", "CONFIRMED", "CHECKED_IN"] } },
        });
        if (upcoming > 0) {
          throw new DataError("CONFLICT", `This branch has ${upcoming} upcoming appointment${upcoming === 1 ? "" : "s"} or booking request${upcoming === 1 ? "" : "s"}. Reschedule, cancel or decline them first.`);
        }
      }
      return toBranch(await tx.branch.update({ where: { id }, data: { status } }));
    }

    if (patch.name && patch.name.toLowerCase() !== branch.name.toLowerCase()) {
      const clash = await tx.branch.findFirst({ where: { clinicId: ctx.clinicId, id: { not: id }, name: { equals: patch.name, mode: "insensitive" } }, select: { id: true } });
      if (clash) throw new DataError("DUPLICATE", `There's already a branch called ${patch.name}.`);
    }
    const row = await tx.branch.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.city !== undefined && { city: patch.city }),
        ...(patch.address !== undefined && { addressLine: patch.address }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(patch.email !== undefined && { email: patch.email }),
      },
    });
    return toBranch(row);
  });
}

// --- Departments ---------------------------------------------------------------

const departmentSelect = {
  id: true, name: true, description: true, branchId: true, specialtyId: true, status: true,
  branch: { select: { name: true } },
  specialty: { select: { name: true } },
  _count: { select: { doctorProfiles: { where: { status: "ACTIVE" as const } } } },
} as const;

type DepartmentRow = {
  id: string; name: string; description: string | null; branchId: string | null; specialtyId: string | null; status: "ACTIVE" | "INACTIVE";
  branch: { name: string } | null; specialty: { name: string } | null; _count: { doctorProfiles: number };
};

const toDepartment = (d: DepartmentRow): LiveDepartment => ({
  id: d.id,
  name: d.name,
  description: d.description,
  branchId: d.branchId,
  branchName: d.branch?.name ?? null,
  specialtyId: d.specialtyId,
  specialtyName: d.specialty?.name ?? null,
  status: d.status === "ACTIVE" ? "active" : "inactive",
  doctorCount: d._count.doctorProfiles,
});

/** Departments of the clinic (a branch-restricted member sees clinic-wide ones and their branch's). */
export async function listDepartments(ctx: TenantContext, db?: TenantTx): Promise<DepartmentPage> {
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.department.findMany({
      where: { clinicId: ctx.clinicId, ...(ctx.branchId ? { OR: [{ branchId: null }, { branchId: ctx.branchId }] } : {}) },
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      select: departmentSelect,
    });
    return { items: rows.map(toDepartment), canManage: hasAnyPermission(ctx, DEPARTMENT_MANAGE) };
  });
}

async function checkDepartmentRefs(ctx: TenantContext, tx: TenantTx, branchId: string | null | undefined, specialtyId: string | null | undefined) {
  if (branchId) {
    if (ctx.branchId && ctx.branchId !== branchId) throw new AuthError("FORBIDDEN");
    const branch = await tx.branch.findFirst({ where: { id: branchId, clinicId: ctx.clinicId }, select: { id: true } });
    if (!branch) throw new DataError("INVALID_INPUT", "Choose one of this clinic's branches.");
  } else if (branchId === null && ctx.branchId) {
    throw new AuthError("FORBIDDEN"); // clinic-wide departments are for clinic-wide admins
  }
  if (specialtyId) {
    const specialty = await tx.specialty.findUnique({ where: { id: specialtyId }, select: { id: true } });
    if (!specialty) throw new DataError("INVALID_INPUT", "Choose a specialty from the list.");
  }
}

async function checkDepartmentName(ctx: TenantContext, tx: TenantTx, name: string, branchId: string | null, exceptId?: string) {
  const clash = await tx.department.findFirst({
    where: { clinicId: ctx.clinicId, branchId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new DataError("DUPLICATE", `There's already a ${name} department ${branchId ? "at that branch" : "for the whole clinic"}.`);
}

export async function createDepartment(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<LiveDepartment> {
  requirePermission(ctx, DEPARTMENT_MANAGE);
  const input = departmentInputSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    await checkDepartmentRefs(ctx, tx, input.branchId, input.specialtyId);
    await checkDepartmentName(ctx, tx, input.name, input.branchId);
    const row = await tx.department.create({
      data: { clinicId: ctx.clinicId, branchId: input.branchId, specialtyId: input.specialtyId, name: input.name, description: input.description },
      select: departmentSelect,
    });
    return toDepartment(row);
  });
}

export async function updateDepartment(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<LiveDepartment> {
  requirePermission(ctx, DEPARTMENT_MANAGE);
  if (!isUuid(id)) throw new AuthError("NOT_FOUND");
  const patch = departmentPatchSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const dept = await tx.department.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { id: true, branchId: true, name: true } });
    if (!dept || (ctx.branchId && dept.branchId !== ctx.branchId)) throw new AuthError("NOT_FOUND");
    if ("status" in patch) {
      return toDepartment(await tx.department.update({ where: { id }, data: { status: patch.status === "active" ? "ACTIVE" : "INACTIVE" }, select: departmentSelect }));
    }
    if (patch.specialtyId !== undefined) await checkDepartmentRefs(ctx, tx, undefined, patch.specialtyId);
    if (patch.name && patch.name.toLowerCase() !== dept.name.toLowerCase()) await checkDepartmentName(ctx, tx, patch.name, dept.branchId, id);
    const row = await tx.department.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.specialtyId !== undefined && { specialtyId: patch.specialtyId }),
      },
      select: departmentSelect,
    });
    return toDepartment(row);
  });
}

// --- Specialties (shared catalogue, with this clinic's usage) -------------------

export async function listSpecialtyUsage(ctx: TenantContext, db?: TenantTx): Promise<{ items: LiveSpecialty[] }> {
  return runScoped(ctx, db, async (tx) => {
    const [specialties, doctors, departments] = await Promise.all([
      tx.specialty.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, description: true } }),
      tx.doctorProfile.groupBy({ by: ["specialtyId"], where: { clinicId: ctx.clinicId, status: "ACTIVE" }, _count: { _all: true } }),
      tx.department.groupBy({ by: ["specialtyId"], where: { clinicId: ctx.clinicId, status: "ACTIVE", specialtyId: { not: null } }, _count: { _all: true } }),
    ]);
    const doctorCount = new Map(doctors.map((d) => [d.specialtyId, d._count._all]));
    const departmentCount = new Map(departments.map((d) => [d.specialtyId, d._count._all]));
    return {
      items: specialties.map((s) => ({ ...s, doctorCount: doctorCount.get(s.id) ?? 0, departmentCount: departmentCount.get(s.id) ?? 0 })),
    };
  });
}

// --- Clinic profile --------------------------------------------------------------

const clinicSelect = { id: true, code: true, name: true, email: true, phone: true, addressLine: true, city: true, state: true, pincode: true, currency: true, status: true } as const;

const capabilities = (ctx: TenantContext): ClinicProfile["can"] => ({
  createBranch: hasAnyPermission(ctx, BRANCH_CREATE) && !ctx.branchId,
  updateBranch: hasAnyPermission(ctx, BRANCH_UPDATE),
  manageDepartments: hasAnyPermission(ctx, DEPARTMENT_MANAGE),
});

async function usage(ctx: TenantContext, tx: TenantTx): Promise<ClinicProfile["usage"]> {
  const can = (keys: readonly string[]) => hasAnyPermission(ctx, keys);
  const [branches, activeBranches, staff, doctors, patients] = await Promise.all([
    tx.branch.count({ where: { clinicId: ctx.clinicId } }),
    tx.branch.count({ where: { clinicId: ctx.clinicId, status: "ACTIVE" } }),
    can(["staff.view", "staff.manage"]) ? tx.clinicMembership.count({ where: { clinicId: ctx.clinicId, status: "ACTIVE", role: { key: { not: "PATIENT" } } } }) : Promise.resolve(0),
    tx.doctorProfile.count({ where: { clinicId: ctx.clinicId, status: "ACTIVE" } }),
    can(["patient.view"]) ? tx.patient.count({ where: { clinicId: ctx.clinicId } }) : Promise.resolve(0),
  ]);
  return { branches, activeBranches, staff, doctors, patients };
}

export async function getClinicProfile(ctx: TenantContext, db?: TenantTx): Promise<ClinicProfile> {
  return runScoped(ctx, db, async (tx) => {
    const clinic = await tx.clinic.findUnique({ where: { id: ctx.clinicId }, select: clinicSelect });
    if (!clinic) throw new AuthError("NOT_FOUND");
    return { ...clinic, status: clinic.status.toLowerCase() as ClinicProfile["status"], canEdit: hasAnyPermission(ctx, CLINIC_EDIT), can: capabilities(ctx), usage: await usage(ctx, tx) };
  });
}

export async function updateClinicProfile(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<ClinicProfile> {
  requirePermission(ctx, CLINIC_EDIT);
  const patch = clinicProfileSchema.parse(raw);
  return runScoped(ctx, db, async (tx) => {
    const clinic = await tx.clinic.update({ where: { id: ctx.clinicId }, data: patch, select: clinicSelect });
    return { ...clinic, status: clinic.status.toLowerCase() as ClinicProfile["status"], canEdit: true, can: capabilities(ctx), usage: await usage(ctx, tx) };
  });
}

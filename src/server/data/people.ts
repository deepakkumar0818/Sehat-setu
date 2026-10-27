import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { assertRecordAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { Branch, Doctor, StaffMember, StaffRole } from "@/types";
import type { StaffCapabilities } from "@/lib/live-types";
import { availabilityFrom, avatarColorFor, ROLE_KEY_TO_STAFF_ROLE, toUiDoctor, type DbDoctorRow } from "./mappers";
import { loadClinicSettings } from "./clinic-settings";
import { pageArgs, runScoped, type Page } from "./scope";
import { invitationsReady, staffPhoneEditReady } from "./p5-schema";
import { featureUnavailable } from "./invitation-rules";
import { phoneSchema, phoneSearchTerms } from "@/lib/phone";
import { istDayKey } from "@/lib/ist";

// Doctors, staff and branches of the verified clinic. Doctor and branch lists
// are directory information visible to every clinic member; staff lists need
// staff/user permissions.

const doctorSelect = {
  id: true, clinicId: true, specialtyId: true, departmentId: true, qualifications: true, registrationNumber: true,
  experienceYears: true, consultationFeePaise: true, bio: true, onlineConsultation: true, status: true, createdAt: true,
  user: { select: { name: true, email: true, phone: true } },
  specialty: { select: { name: true } },
  branches: { select: { branchId: true, isPrimary: true } },
} as const;

export const listDoctorsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  branchId: z.string().optional(),
  specialization: z.string().max(100).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
  onlineOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listDoctors(
  ctx: TenantContext,
  input: z.infer<typeof listDoctorsSchema>,
  db?: TenantTx
): Promise<Page<Doctor> & { capabilities: { canInviteDoctors: boolean; invitationsReady: boolean } }> {
  // Doctor invitations need both user.create and doctor.manage (Administrators); the server re-checks.
  const canInviteDoctors = hasAnyPermission(ctx, INVITATION_MANAGE) && hasAnyPermission(ctx, ["doctor.manage"]);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 200);
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    ...(input.status && input.status !== "all" ? { status: input.status.toUpperCase() as "ACTIVE" | "INACTIVE" } : {}),
    ...(input.branchId && input.branchId !== "all" ? { branches: { some: { branchId: input.branchId } } } : {}),
    ...(input.specialization && input.specialization !== "all" ? { specialty: { name: input.specialization } } : {}),
    ...(input.onlineOnly === "true" ? { onlineConsultation: true } : {}),
    ...(search
      ? { OR: [{ user: { name: { contains: search, mode: "insensitive" as const } } }, { specialty: { name: { contains: search, mode: "insensitive" as const } } }] }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.doctorProfile.findMany({ where, orderBy: [{ user: { name: "asc" } }, { id: "asc" }], skip, take, select: doctorSelect }),
      tx.doctorProfile.count({ where }),
    ]);
    const capabilities = { canInviteDoctors, invitationsReady: canInviteDoctors ? await invitationsReady(tx) : false };
    const availability = availabilityFrom((await loadClinicSettings(tx, ctx.clinicId)).weeklyHours);
    return { items: rows.map((r) => toUiDoctor(r as DbDoctorRow, availability)), total, page, pageSize, capabilities };
  });
}

export async function getDoctor(ctx: TenantContext, id: string, db?: TenantTx): Promise<Doctor> {
  if (!z.string().uuid().safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    const row = await tx.doctorProfile.findFirst({ where: { id, clinicId: ctx.clinicId }, select: doctorSelect });
    const availability = availabilityFrom((await loadClinicSettings(tx, ctx.clinicId)).weeklyHours);
    return toUiDoctor(assertRecordAccess({ ...ctx, branchId: null }, row) as DbDoctorRow, availability);
  });
}

const STAFF_ROLE_TO_KEY: Partial<Record<StaffRole, keyof typeof ROLE_KEY_TO_STAFF_ROLE>> = {
  clinic_admin: "ADMINISTRATOR",
  branch_manager: "CLINIC_MANAGER",
  receptionist: "RECEPTIONIST",
  nurse: "NURSE",
};

export const listStaffSchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.string().max(40).optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

/** Non-doctor, non-patient clinic memberships. A StaffMember's id is its membership id. */
export const STAFF_STATUS_MANAGE = ["staff.manage", "user.disable"] as const;
export const INVITATION_MANAGE = ["user.create"] as const;
export const INVITATION_VIEW = ["user.create", "user.view", "staff.view"] as const;

/** Editing a staff member's phone (users.phone): Administrators only. */
export const STAFF_PHONE_MANAGE = ["user.update"] as const;

export function staffCapabilities(ctx: TenantContext, ready = false, phoneEditReady = false): StaffCapabilities {
  return {
    canChangeStatus: hasAnyPermission(ctx, STAFF_STATUS_MANAGE),
    canInvite: hasAnyPermission(ctx, INVITATION_MANAGE),
    canViewInvitations: hasAnyPermission(ctx, INVITATION_VIEW),
    invitationsReady: ready,
    canEditPhone: hasAnyPermission(ctx, STAFF_PHONE_MANAGE) && phoneEditReady,
  };
}

export async function listStaff(
  ctx: TenantContext,
  input: z.infer<typeof listStaffSchema>,
  db?: TenantTx
): Promise<Page<StaffMember> & { capabilities: StaffCapabilities }> {
  requirePermission(ctx, ["staff.view", "staff.manage", "user.view"]);
  let capabilities = staffCapabilities(ctx);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const roleFilter = input.role && input.role !== "all" ? STAFF_ROLE_TO_KEY[input.role as StaffRole] : undefined;
  if (input.role && input.role !== "all" && !roleFilter) return { items: [], total: 0, page, pageSize, capabilities }; // role not used by this clinic's database
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    role: roleFilter ? { key: roleFilter } : { key: { in: Object.keys(ROLE_KEY_TO_STAFF_ROLE) as (keyof typeof ROLE_KEY_TO_STAFF_ROLE)[] } },
    ...(ctx.branchId ? { OR: [{ branchId: ctx.branchId }, { branchId: null }] } : {}),
    ...(input.branchId && input.branchId !== "all" ? { branchId: input.branchId } : {}),
    ...(search
      ? {
          user: {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
              // "98765 43210" also finds "+919876543210" (numbers are stored in E.164).
              ...phoneSearchTerms(search).map((t) => ({ phone: { contains: t } })),
            ],
          },
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const ready = capabilities.canInvite || capabilities.canViewInvitations ? await invitationsReady(tx) : false;
    const phoneReady = hasAnyPermission(ctx, STAFF_PHONE_MANAGE) ? await staffPhoneEditReady(tx) : false;
    capabilities = staffCapabilities(ctx, ready, phoneReady);
    const [rows, total] = await Promise.all([
      tx.clinicMembership.findMany({
        where,
        orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
        skip,
        take,
        select: { id: true, clinicId: true, branchId: true, status: true, createdAt: true, userId: true, role: { select: { key: true } }, user: { select: { name: true, email: true, phone: true } } },
      }),
      tx.clinicMembership.count({ where }),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        clinicId: m.clinicId,
        name: m.user.name,
        role: ROLE_KEY_TO_STAFF_ROLE[m.role.key as keyof typeof ROLE_KEY_TO_STAFF_ROLE],
        branchId: m.branchId ?? "",
        phone: m.user.phone ?? "",
        email: m.user.email,
        status: m.status === "ACTIVE" ? "active" : "inactive",
        lastActiveAt: "", // not tracked in the database
        joinedDate: istDayKey(m.createdAt).date,
        avatarColor: avatarColorFor(m.id),
        // Mirrors setStaffStatus: permission, branch scope, and never your own access.
        canChangeStatus: capabilities.canChangeStatus && m.userId !== ctx.userId && (!ctx.branchId || m.branchId === ctx.branchId),
        // Mirrors app.set_staff_phone's scope check (the database also refuses a person shared with another clinic).
        canEditPhone: capabilities.canEditPhone && (!ctx.branchId || m.branchId === ctx.branchId),
      })),
      total,
      page,
      pageSize,
      capabilities,
    };
  });
}

export const staffStatusSchema = z.object({ status: z.enum(["active", "inactive"]) }).strict();

/** Activate/deactivate a staff membership. Nobody can deactivate their own access. */
export async function setStaffStatus(ctx: TenantContext, membershipId: string, raw: unknown, db?: TenantTx): Promise<{ id: string; status: StaffMember["status"] }> {
  requirePermission(ctx, STAFF_STATUS_MANAGE);
  const { status } = staffStatusSchema.parse(raw);
  if (!z.string().uuid().safeParse(membershipId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    const m = await tx.clinicMembership.findFirst({
      where: { id: membershipId, clinicId: ctx.clinicId, role: { key: { in: Object.keys(ROLE_KEY_TO_STAFF_ROLE) as (keyof typeof ROLE_KEY_TO_STAFF_ROLE)[] } } },
      select: { id: true, userId: true, branchId: true },
    });
    if (!m) throw new AuthError("NOT_FOUND");
    if (ctx.branchId && m.branchId !== ctx.branchId) throw new AuthError("NOT_FOUND");
    if (m.userId === ctx.userId) throw new DataError("CONFLICT", "You can't change your own access.");
    await tx.clinicMembership.update({ where: { id: m.id }, data: { status: status === "active" ? "ACTIVE" : "INACTIVE" } });
    return { id: m.id, status };
  });
}

export const staffPhoneSchema = z.object({ phone: phoneSchema }).strict();

const PHONE_ERRORS: Record<string, () => Error> = {
  NOT_PERMITTED: () => new AuthError("FORBIDDEN"),
  NOT_FOUND: () => new AuthError("NOT_FOUND"),
  INVALID_PHONE: () => new DataError("INVALID_INPUT", "Enter a valid phone number with its country code."),
  // Deliberately vague: the clinic shouldn't learn where else the person works.
  SHARED_ACCOUNT: () =>
    new DataError("PHONE_LOCKED", "This person's phone number is linked to their account elsewhere and can't be changed from this clinic. Ask them to contact Sehat Setu support."),
};

/**
 * Set a staff member's phone (users.phone) through app.set_staff_phone, which
 * re-checks permission, clinic/branch scope, the target and the cross-clinic rule.
 * Returns the stored E.164 number to the administrator who set it.
 */
export async function setStaffPhone(ctx: TenantContext, membershipId: string, raw: unknown, db?: TenantTx): Promise<{ id: string; phone: string }> {
  requirePermission(ctx, STAFF_PHONE_MANAGE);
  const { phone } = staffPhoneSchema.parse(raw);
  if (!z.string().uuid().safeParse(membershipId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    if (!(await staffPhoneEditReady(tx))) throw featureUnavailable("Phone editing");
    try {
      await tx.$queryRaw`SELECT app.set_staff_phone(${membershipId}::uuid, ${phone})::text AS id`;
    } catch (err) {
      const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? "")}` : "";
      const code = /staff phone: ([A-Z_]+)/.exec(text)?.[1];
      const mapped = code ? PHONE_ERRORS[code] : undefined;
      if (mapped) throw mapped();
      throw err;
    }
    return { id: membershipId, phone };
  });
}

/** PATCH /api/v1/staff/[id]: exactly one of { status } or { phone }. */
export async function updateStaffMember(ctx: TenantContext, membershipId: string, raw: unknown, db?: TenantTx) {
  const keys = raw && typeof raw === "object" ? Object.keys(raw) : [];
  if (keys.length === 1 && keys[0] === "phone") return setStaffPhone(ctx, membershipId, raw, db);
  return setStaffStatus(ctx, membershipId, raw, db);
}

export async function listBranches(ctx: TenantContext, db?: TenantTx): Promise<Branch[]> {
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.branch.findMany({
      where: { clinicId: ctx.clinicId, ...(ctx.branchId ? { id: ctx.branchId } : {}) },
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    });
    return rows.map((b) => ({
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
    }));
  });
}

import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError, type DataErrorCode } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { ClinicUsersPage, LiveClinicUser } from "@/lib/live-types";
import { ROLE_KEY_TO_USER_ROLE } from "@/lib/auth/session-user";
import type { UserRole } from "@/types";
import { isUuid } from "./clinic-admin-rules";
import { errorText } from "./document-rules";
import { runScoped } from "./scope";

// Users & Roles: everyone holding a staff role in the clinic — doctors and
// other staff together — with their role, branch, status and any per-person
// permission changes. Administrators change a person's role or permissions
// here; the database functions (app.change_member_role, app.set_member_permissions)
// enforce who may do what, and app.staff_can applies the result everywhere.
// People are invited on /staff (doctors via the Doctors page).

export const CLINIC_USERS_VIEW = ["staff.view", "staff.manage", "user.view", "role.manage", "clinic.settings.manage"] as const;
export const MEMBER_ACCESS_MANAGE = ["role.manage"] as const;

const STAFF_ROLE_KEYS = ["ADMINISTRATOR", "CLINIC_MANAGER", "DOCTOR", "RECEPTIONIST", "NURSE"] as const;
type StaffRoleKey = (typeof STAFF_ROLE_KEYS)[number];
/** Roles a person can be moved between here (Doctor needs a doctor profile: Doctors page). */
const CHANGEABLE_ROLE_KEYS: readonly StaffRoleKey[] = ["ADMINISTRATOR", "CLINIC_MANAGER", "RECEPTIONIST", "NURSE"];

const toUserRole = (key: StaffRoleKey) => ROLE_KEY_TO_USER_ROLE[key] as UserRole;
const ROLE_KEY_OF = Object.fromEntries(STAFF_ROLE_KEYS.map((k) => [toUserRole(k), k])) as Partial<Record<UserRole, StaffRoleKey>>;

/** Only clinic-wide administrators manage access (as the database functions require). */
const canManageAccess = (ctx: TenantContext) => hasAnyPermission(ctx, MEMBER_ACCESS_MANAGE) && !ctx.branchId;

export async function listClinicUsers(ctx: TenantContext, db?: TenantTx): Promise<ClinicUsersPage> {
  requirePermission(ctx, CLINIC_USERS_VIEW);
  const canManage = canManageAccess(ctx);
  return runScoped(ctx, db, async (tx) => {
    // RLS: only this clinic's memberships, people, doctor profiles and overrides
    // (a branch-restricted member sees their branch's; overrides need role.manage).
    const [memberships, roles, permissions, overrides] = await Promise.all([
      tx.clinicMembership.findMany({
        where: { clinicId: ctx.clinicId, role: { key: { in: [...STAFF_ROLE_KEYS] } } },
        orderBy: [{ status: "asc" }, { user: { name: "asc" } }, { id: "asc" }],
        select: {
          id: true, status: true, createdAt: true, branchId: true,
          role: { select: { key: true } },
          branch: { select: { name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      tx.role.findMany({ where: { key: { in: [...STAFF_ROLE_KEYS] } }, select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } }),
      tx.permission.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }], select: { id: true, key: true, name: true, module: true, description: true } }),
      canManage
        ? tx.memberPermissionOverride.findMany({ where: { clinicId: ctx.clinicId }, select: { membershipId: true, permissionId: true, effect: true } })
        : Promise.resolve([] as { membershipId: string; permissionId: string; effect: "GRANT" | "REVOKE" }[]),
    ]);
    const doctors = await tx.doctorProfile.findMany({
      where: { clinicId: ctx.clinicId, userId: { in: memberships.map((m) => m.user.id) } },
      select: { userId: true, specialty: { select: { name: true } }, department: { select: { name: true } } },
    });
    const doctorOf = new Map(doctors.map((d) => [d.userId, d]));
    const keyOf = new Map(permissions.map((p) => [p.id, p.key]));
    const overridesOf = (membershipId: string, effect: "GRANT" | "REVOKE") =>
      overrides
        .filter((o) => o.membershipId === membershipId && o.effect === effect)
        .map((o) => keyOf.get(o.permissionId))
        .filter((k): k is string => Boolean(k))
        .sort();

    const items: LiveClinicUser[] = memberships.map((m) => {
      const roleKey = m.role.key as StaffRoleKey;
      const doctor = roleKey === "DOCTOR" ? doctorOf.get(m.user.id) : undefined;
      const editable = canManage && m.user.id !== ctx.userId;
      return {
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: toUserRole(roleKey),
        specialtyName: doctor?.specialty.name ?? null,
        departmentName: doctor?.department?.name ?? null,
        branchId: m.branchId,
        branchName: m.branch?.name ?? null,
        status: m.status === "ACTIVE" ? "active" : "inactive",
        joinedDate: m.createdAt.toISOString(),
        granted: overridesOf(m.id, "GRANT"),
        revoked: overridesOf(m.id, "REVOKE"),
        canEditPermissions: editable,
        canChangeRole: editable && CHANGEABLE_ROLE_KEYS.includes(roleKey),
      };
    });

    return {
      items,
      canManage,
      changeableRoles: CHANGEABLE_ROLE_KEYS.map(toUserRole),
      roleDefaults: Object.fromEntries(roles.map((r) => [toUserRole(r.key as StaffRoleKey), r.permissions.map((p) => p.permission.key).sort()])),
      permissions: permissions.map(({ key, name, module, description }) => ({ key, name, module, description })),
    };
  });
}

const permissionKeys = z.array(z.string().trim().min(1).max(64)).max(200);
export const memberAccessPatchSchema = z.union([
  z.object({ role: z.string() }).strict(),
  z.object({ granted: permissionKeys, revoked: permissionKeys }).strict(),
]);

const MESSAGES: Record<string, [DataErrorCode, string]> = {
  SELF: ["INVALID_INPUT", "You can't change your own role or permissions. Ask another administrator."],
  NOT_STAFF: ["INVALID_INPUT", "This person isn't a staff member."],
  CONFLICTING: ["INVALID_INPUT", "A permission can't be both added and removed."],
  UNKNOWN_PERMISSION: ["INVALID_INPUT", "One of the permissions doesn't exist. Reload the page and try again."],
  ROLE_CHANGE_UNSUPPORTED: ["INVALID_INPUT", "Doctors keep the Doctor role. To make someone a doctor, invite them from the Doctors page."],
  ALREADY_HAS_ROLE: ["DUPLICATE", "This person already has that role in your clinic."],
  LAST_ADMIN: ["INVALID_INPUT", "Your clinic must keep at least one Clinic Admin."],
};

export function mapMemberAccessError(err: unknown): never {
  const m = /member access: ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  if (m[1] === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (m[1] === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = MESSAGES[m[1]];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

/** { role } moves the person to another staff role (their custom permissions are cleared); { granted, revoked } sets their permission changes. */
export async function updateMemberAccess(ctx: TenantContext, membershipId: string, raw: unknown, db?: TenantTx): Promise<{ ok: true }> {
  requirePermission(ctx, MEMBER_ACCESS_MANAGE);
  if (ctx.branchId) throw new AuthError("FORBIDDEN");
  if (!isUuid(membershipId)) throw new AuthError("NOT_FOUND");
  const patch = memberAccessPatchSchema.parse(raw);
  let roleKey: StaffRoleKey | undefined;
  if ("role" in patch) {
    roleKey = ROLE_KEY_OF[patch.role as UserRole];
    if (!roleKey) throw new DataError("INVALID_INPUT", "Choose one of the listed roles.");
  }
  return runScoped(ctx, db, async (tx) => {
    try {
      if (roleKey) {
        await tx.$executeRaw`SELECT app.change_member_role(${membershipId}::uuid, ${roleKey})`;
      } else if ("granted" in patch) {
        await tx.$executeRaw`SELECT app.set_member_permissions(${membershipId}::uuid, ${patch.granted}::text[], ${patch.revoked}::text[])`;
      }
      return { ok: true as const };
    } catch (err) {
      mapMemberAccessError(err);
    }
  });
}

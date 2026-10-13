// Core RBAC + tenant-isolation enforcement. This is the ONE place permission
// and multi-tenant access decisions are made — services call these helpers
// rather than re-implementing role/clinic checks inline, and UI reads the
// same result via the usePermission()/useCan() hooks in hooks/use-rbac.ts.
//
// In a real backend these checks would run server-side per request; here
// they run in the mock service layer, which is the closest equivalent in an
// app with no server boundary yet (see src/services/*.ts).
import { ROLE_PERMISSION_DEFAULTS } from "@/data/permission-catalog";
import type { AuthUser, Branch, SehatSetuDatabase } from "@/types";

/** Resolve the effective permission-key set for a signed-in user. */
export function permissionsForUser(user: AuthUser | null | undefined, db: SehatSetuDatabase): string[] {
  if (!user) return [];
  if (user.roleId) {
    const role = db.roles.find((r) => r.id === user.roleId);
    if (role) return role.permissionKeys;
  }
  return ROLE_PERMISSION_DEFAULTS[user.role] ?? [];
}

/** Does this user hold the given permission key? */
export function can(user: AuthUser | null | undefined, permissionKey: string, db: SehatSetuDatabase): boolean {
  return permissionsForUser(user, db).includes(permissionKey);
}

/** Does this user hold every one of the given permission keys? */
export function canAll(user: AuthUser | null | undefined, permissionKeys: string[], db: SehatSetuDatabase): boolean {
  const owned = new Set(permissionsForUser(user, db));
  return permissionKeys.every((k) => owned.has(k));
}

/** Does this user hold at least one of the given permission keys? */
export function canAny(user: AuthUser | null | undefined, permissionKeys: string[], db: SehatSetuDatabase): boolean {
  const owned = new Set(permissionsForUser(user, db));
  return permissionKeys.some((k) => owned.has(k));
}

export class TenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}

/**
 * Throws if `user` is not authorized for `clinicId`. super_admin (platform
 * scope, no clinicId) always passes — every clinic-scoped role must match.
 */
export function assertClinicAccess(user: AuthUser | null | undefined, clinicId: string): void {
  if (!user) throw new TenantAccessError("Not signed in.");
  if (user.role === "super_admin") return;
  if (user.clinicId !== clinicId) {
    throw new TenantAccessError("You do not have access to this clinic.");
  }
}

/**
 * Throws if `user` is not authorized for the given branch. Resolves the
 * branch's owning clinic first, so a clinic-level user (owner/admin) passes
 * for any branch in their clinic, while a branch_manager (or other
 * branch-scoped role) must match the specific branch.
 */
export function assertBranchAccess(user: AuthUser | null | undefined, branch: Branch): void {
  assertClinicAccess(user, branch.clinicId);
  if (!user) return;
  const branchScopedRoles: Array<AuthUser["role"]> = ["branch_manager", "doctor", "receptionist", "nurse", "pharmacist", "lab_staff", "billing_staff", "accountant"];
  if (branchScopedRoles.includes(user.role) && user.branchId && user.branchId !== branch.id) {
    throw new TenantAccessError("You do not have access to this branch.");
  }
}

/** Look up the clinicId that owns a branch — the transitive link used for tenant isolation on branch-scoped records (appointments, invoices, etc. carry branchId, not their own clinicId). */
export function clinicIdForBranch(db: SehatSetuDatabase, branchId: string): string | undefined {
  return db.branches.find((b) => b.id === branchId)?.clinicId;
}

/**
 * The set of branch ids a signed-in staff/doctor user may see across
 * clinic-wide list views (patients, doctors, appointments, billing, ...).
 * Returns `"all"` for super_admin (platform scope, no filtering) and for a
 * signed-out/patient session (this only governs STAFF list views — patient
 * portal queries are already scoped to that one patient's own records
 * elsewhere, and the public site never calls these services at all).
 * Everyone else is restricted to the branches under their own clinicId.
 */
export function visibleBranchIds(user: AuthUser | null | undefined, db: SehatSetuDatabase): string[] | "all" {
  if (!user || user.role === "super_admin" || user.role === "patient") return "all";
  if (!user.clinicId) return "all"; // legacy/demo session predating clinicId — don't accidentally hide everything
  return db.branches.filter((b) => b.clinicId === user.clinicId).map((b) => b.id);
}

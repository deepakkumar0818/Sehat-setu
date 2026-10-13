import { delay } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { logAudit } from "@/services/audit";
import { PERMISSION_CATALOG } from "@/data/permission-catalog";
import type { AuthUser, Role } from "@/types";

export async function listRolesForClinic(clinicId: string): Promise<Role[]> {
  await delay(250);
  return getDb().roles.filter((r) => r.clinicId === clinicId);
}

export async function getRole(id: string): Promise<Role | undefined> {
  await delay(150);
  return getDb().roles.find((r) => r.id === id);
}

export interface CreateCustomRoleInput {
  clinicId: string;
  name: string;
  description: string;
  permissionKeys: string[];
  actor: Pick<AuthUser, "name" | "role">;
}

export async function createCustomRole(input: CreateCustomRoleInput): Promise<Role> {
  await delay(400);
  const db = getDb();
  const validKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
  const role: Role = {
    id: padId("ROLE-CUSTOM", db.roles.length + 1, 4),
    name: input.name,
    description: input.description,
    scope: "clinic",
    clinicId: input.clinicId,
    isSystemRole: false,
    permissionKeys: input.permissionKeys.filter((k) => validKeys.has(k)),
  };
  mutateDb((d) => ({ ...d, roles: [...d.roles, role] }));
  logAudit({ actor: input.actor, action: "Created custom role", entityType: "role", entityId: role.id });
  return role;
}

/** System roles cannot be edited — clone one into a new custom role instead. */
export async function updateCustomRolePermissions(roleId: string, permissionKeys: string[], actor: Pick<AuthUser, "name" | "role">): Promise<Role> {
  await delay(350);
  const existing = getDb().roles.find((r) => r.id === roleId);
  if (!existing) throw new Error("Role not found");
  if (existing.isSystemRole) throw new Error("System roles cannot be edited — duplicate it into a custom role first.");

  const validKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
  let updated: Role | undefined;
  mutateDb((d) => ({
    ...d,
    roles: d.roles.map((r) => {
      if (r.id !== roleId) return r;
      updated = { ...r, permissionKeys: permissionKeys.filter((k) => validKeys.has(k)) };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Role not found");
  logAudit({ actor, action: "Updated role permissions", entityType: "role", entityId: roleId });
  return updated;
}

export async function duplicateRoleAsCustom(roleId: string, newName: string, actor: Pick<AuthUser, "name" | "role">): Promise<Role> {
  const source = await getRole(roleId);
  if (!source) throw new Error("Role not found");
  if (!source.clinicId) throw new Error("Cannot duplicate a platform-level role into a clinic.");
  return createCustomRole({
    clinicId: source.clinicId,
    name: newName,
    description: `Copied from ${source.name}.`,
    permissionKeys: [...source.permissionKeys],
    actor,
  });
}

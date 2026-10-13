import type { UserRole } from "@/types";

/** Database role keys (prisma RoleKey) → the UI's existing UserRole values, which drive navigation. */
export const ROLE_KEY_TO_USER_ROLE = {
  ADMINISTRATOR: "clinic_admin",
  CLINIC_MANAGER: "branch_manager",
  DOCTOR: "doctor",
  RECEPTIONIST: "receptionist",
  NURSE: "nurse",
  PATIENT: "patient",
} as const satisfies Record<string, UserRole>;

export type DbRoleKey = keyof typeof ROLE_KEY_TO_USER_ROLE;

const STAFF_PRECEDENCE: DbRoleKey[] = ["ADMINISTRATOR", "CLINIC_MANAGER", "DOCTOR", "RECEPTIONIST", "NURSE"];

/** The UI role for someone holding several roles in one clinic: the broadest one decides their navigation. */
export function primaryUserRole(roles: readonly string[]): UserRole {
  const key = STAFF_PRECEDENCE.find((r) => roles.includes(r)) ?? (roles.includes("PATIENT") ? "PATIENT" : undefined);
  if (!key) throw new Error("No recognised role");
  return ROLE_KEY_TO_USER_ROLE[key];
}

/**
 * The identity the SERVER verified for this request, passed from a server
 * layout to the client shell. Serializable; contains no permissions or ids
 * the client could use to widen access — the server re-checks everything.
 */
export interface ServerSessionUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  clinicName?: string;
}

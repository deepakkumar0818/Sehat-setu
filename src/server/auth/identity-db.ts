import "server-only";
import type { TenantTx } from "@/server/db/tenant";
import type { Identity, MembershipRecord } from "@/server/auth/authorize";

// The database half of loadIdentity (src/server/auth/session.ts), kept out of
// session.ts so it has no request (cookies/headers) dependencies.
//
// It runs on every authenticated request, inside withIdentityDb, and each
// statement is a full round-trip to the remote pooler (~0.1s). The previous
// Prisma nested select (memberships -> clinic, role -> role_permissions ->
// permission) issued 5 queries, plus separate ones for the user, the user-id
// pin, doctor profiles and patient links: 11 round-trips. These two
// statements return the same data. They still run as sehat_app under RLS, with
// the same context pinned, so they see exactly the rows the old queries saw.

export interface IdentityUserRow {
  id: string;
  email: string;
  name: string;
  status: Identity["status"];
  authProviderId: string | null;
}

/**
 * The application user linked to this Supabase user (RLS: users_read lets the
 * pinned app.auth_user_id see its own row), and — in the same statement —
 * app.user_id pinned to it, which the own-row policies of the next query read.
 * The pin happens only when a row is visible, i.e. only for this user.
 */
export async function findUserAndPin(tx: TenantTx, authUserId: string): Promise<IdentityUserRow | null> {
  const rows = await tx.$queryRaw<(IdentityUserRow & { pinned: string })[]>`
    SELECT id::text AS id, email, name, status::text AS status, "authProviderId",
           set_config('app.user_id', id::text, true) AS pinned
    FROM users WHERE "authProviderId" = ${authUserId}`;
  const row = rows[0];
  return row ? { id: row.id, email: row.email, name: row.name, status: row.status, authProviderId: row.authProviderId } : null;
}

type MembershipsAndLinks = Pick<Identity, "memberships"> & Required<Pick<Identity, "doctorProfiles" | "patientLinks" | "platformAdmin">>;

/**
 * Memberships (with clinic, role and effective permission keys), active doctor
 * profiles and active patient links of `userId`, in one statement. Requires
 * app.user_id pinned to `userId` (findUserAndPin): RLS (memberships_read,
 * clinics_read, member_permission_overrides_read, doctor_profiles_read,
 * patients_read) exposes only this user's own rows.
 */
export async function loadMembershipsAndLinks(tx: TenantTx, userId: string): Promise<MembershipsAndLinks> {
  const [row] = await tx.$queryRaw<{ memberships: MembershipRecord[]; doctorProfiles: { id: string; clinicId: string }[]; patientLinks: { patientId: string; clinicId: string }[]; platformAdmin: boolean }[]>`
    SELECT
      (SELECT coalesce(json_agg(json_build_object(
                'id', m.id, 'clinicId', m."clinicId", 'clinicName', c.name, 'clinicStatus', c.status,
                'branchId', m."branchId", 'roleKey', r.key, 'status', m.status,
                -- Effective permissions: the role's, minus this member's REVOKEs, plus their
                -- GRANTs (member_permission_overrides) — the same rule as app.staff_can.
                'permissions', (SELECT coalesce(json_agg(p.key), '[]'::json)
                                FROM permissions p
                                WHERE (EXISTS (SELECT 1 FROM role_permissions rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id)
                                       AND NOT EXISTS (SELECT 1 FROM member_permission_overrides o
                                                       WHERE o."membershipId" = m.id AND o."permissionId" = p.id AND o.effect = 'REVOKE'))
                                   OR EXISTS (SELECT 1 FROM member_permission_overrides o
                                              WHERE o."membershipId" = m.id AND o."permissionId" = p.id AND o.effect = 'GRANT')))), '[]'::json)
         FROM clinic_memberships m
         JOIN clinics c ON c.id = m."clinicId"
         JOIN roles r ON r.id = m."roleId"
        WHERE m."userId" = ${userId}::uuid) AS memberships,
      (SELECT coalesce(json_agg(json_build_object('id', d.id, 'clinicId', d."clinicId")), '[]'::json)
         FROM doctor_profiles d WHERE d."userId" = ${userId}::uuid AND d.status = 'ACTIVE') AS "doctorProfiles",
      (SELECT coalesce(json_agg(json_build_object('patientId', pt.id, 'clinicId', pt."clinicId")), '[]'::json)
         FROM patients pt WHERE pt."userId" = ${userId}::uuid AND pt.status = 'ACTIVE') AS "patientLinks",
      -- Platform super admin (migration 20261103000000_platform_admin): checked against the pinned login.
      app.is_platform_admin() AS "platformAdmin"`;
  return row;
}

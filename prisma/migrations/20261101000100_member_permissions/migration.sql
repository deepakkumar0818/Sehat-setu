-- Per-person permissions and role changes, managed by clinic administrators.
-- * member_permission_overrides: for one clinic membership, a permission GRANTed
--   on top of its role's defaults, or a default REVOKEd. Effective permissions =
--   (role defaults − revoked) ∪ granted.
-- * app.staff_can (every RLS policy's permission check) now applies them; the app
--   applies the same rule when it loads a session (src/server/auth/identity-db.ts),
--   so a change takes effect on the person's next request.
-- * Writes only through two SECURITY DEFINER functions, callable by a clinic-wide
--   member holding role.manage (Administrators), never on their own membership:
--   - app.set_member_permissions(membership, grants, revokes) replaces a member's
--     overrides (staff roles only; doctors included);
--   - app.change_member_role(membership, role) moves a member between the
--     non-clinical staff roles (Administrator, Clinic Manager, Receptionist, Nurse),
--     never removing the clinic's last active Administrator, and clears the
--     member's overrides (they were relative to the old role). Doctor isn't
--     offered either way: a doctor needs a doctor profile (Doctors page).
-- * Audited by the row-change trigger (who changed which membership; no values).
-- Additive except app.staff_can, whose body is otherwise unchanged from
-- 20261013000100_member_status_rule.

CREATE TYPE "PermissionEffect" AS ENUM ('GRANT', 'REVOKE');

CREATE TABLE "member_permission_overrides" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"        uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "membershipId"    uuid NOT NULL REFERENCES clinic_memberships(id) ON DELETE CASCADE,
  "permissionId"    uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  "effect"          "PermissionEffect" NOT NULL,
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt"       timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT member_permission_overrides_once UNIQUE ("membershipId", "permissionId")
);
CREATE INDEX member_permission_overrides_clinic_idx ON member_permission_overrides ("clinicId");

-- ---------------------------------------------------------------------------
-- Privileges: read only; every write goes through the functions below
-- ---------------------------------------------------------------------------
REVOKE ALL ON member_permission_overrides FROM anon, authenticated;
GRANT SELECT ON member_permission_overrides TO sehat_app;

ALTER TABLE member_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Your own (loading your session), or your clinic's when you may manage roles.
CREATE POLICY member_permission_overrides_read ON member_permission_overrides FOR SELECT TO sehat_app USING (
  EXISTS (SELECT 1 FROM clinic_memberships m WHERE m.id = "membershipId" AND m."userId" = (SELECT app.current_user_id()))
  OR ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['role.manage'])))
);

CREATE TRIGGER audit_member_permission_overrides AFTER INSERT OR UPDATE OR DELETE ON member_permission_overrides FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- The permission check, now with per-member overrides
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.staff_can(keys text[]) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.roles r ON r.id = m."roleId"
    JOIN public.permissions p ON p.key = ANY (keys)
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status <> 'DISABLED'
      AND r.key <> 'PATIENT'
      AND (m."branchId" IS NULL OR m."branchId" = app.current_branch_id())
      AND (
        (EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id)
         AND NOT EXISTS (SELECT 1 FROM public.member_permission_overrides o
                         WHERE o."membershipId" = m.id AND o."permissionId" = p.id AND o.effect = 'REVOKE'))
        OR EXISTS (SELECT 1 FROM public.member_permission_overrides o
                   WHERE o."membershipId" = m.id AND o."permissionId" = p.id AND o.effect = 'GRANT')
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- The target membership, locked, after the caller checks shared by both writes.
CREATE FUNCTION app.lock_manageable_membership(p_membership_id uuid) RETURNS public.clinic_memberships
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_member public.clinic_memberships;
BEGIN
  IF app.current_clinic_id() IS NULL OR app.current_branch_id() IS NOT NULL OR NOT app.staff_can(ARRAY['role.manage']) THEN
    RAISE EXCEPTION 'member access: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_member FROM public.clinic_memberships
   WHERE id = p_membership_id AND "clinicId" = app.current_clinic_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member access: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_member."userId" = app.current_user_id() THEN
    RAISE EXCEPTION 'member access: SELF' USING ERRCODE = '42501';
  END IF;
  IF (SELECT key FROM public.roles WHERE id = v_member."roleId") = 'PATIENT' THEN
    RAISE EXCEPTION 'member access: NOT_STAFF' USING ERRCODE = '22023';
  END IF;
  RETURN v_member;
END;
$$;

CREATE FUNCTION app.set_member_permissions(p_membership_id uuid, p_grants text[], p_revokes text[]) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_member public.clinic_memberships := app.lock_manageable_membership(p_membership_id);
  v_grants text[] := coalesce(p_grants, '{}');
  v_revokes text[] := coalesce(p_revokes, '{}');
BEGIN
  IF v_grants && v_revokes THEN
    RAISE EXCEPTION 'member access: CONFLICTING' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_grants || v_revokes) k WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = k)) THEN
    RAISE EXCEPTION 'member access: UNKNOWN_PERMISSION' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.member_permission_overrides WHERE "membershipId" = v_member.id;
  -- Only real differences from the role's defaults are stored.
  INSERT INTO public.member_permission_overrides ("clinicId", "membershipId", "permissionId", effect, "createdByUserId")
  SELECT v_member."clinicId", v_member.id, p.id, 'GRANT'::public."PermissionEffect", app.current_user_id()
    FROM public.permissions p
   WHERE p.key = ANY (v_grants)
     AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp."roleId" = v_member."roleId" AND rp."permissionId" = p.id)
  UNION ALL
  SELECT v_member."clinicId", v_member.id, p.id, 'REVOKE'::public."PermissionEffect", app.current_user_id()
    FROM public.permissions p
   WHERE p.key = ANY (v_revokes)
     AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp."roleId" = v_member."roleId" AND rp."permissionId" = p.id);
END;
$$;

CREATE FUNCTION app.change_member_role(p_membership_id uuid, p_role text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_member public.clinic_memberships := app.lock_manageable_membership(p_membership_id);
  v_old text := (SELECT key::text FROM public.roles WHERE id = v_member."roleId");
  v_new_role uuid;
BEGIN
  IF v_old NOT IN ('ADMINISTRATOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE')
     OR p_role IS NULL OR p_role NOT IN ('ADMINISTRATOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE') THEN
    RAISE EXCEPTION 'member access: ROLE_CHANGE_UNSUPPORTED' USING ERRCODE = '22023';
  END IF;
  IF v_old = p_role THEN
    RETURN;
  END IF;
  SELECT id INTO v_new_role FROM public.roles WHERE key = p_role::public."RoleKey";
  IF EXISTS (SELECT 1 FROM public.clinic_memberships
              WHERE "userId" = v_member."userId" AND "clinicId" = v_member."clinicId" AND "roleId" = v_new_role) THEN
    RAISE EXCEPTION 'member access: ALREADY_HAS_ROLE' USING ERRCODE = '23505';
  END IF;
  IF v_old = 'ADMINISTRATOR' AND v_member.status = 'ACTIVE' AND NOT EXISTS (
       SELECT 1 FROM public.clinic_memberships x JOIN public.roles r ON r.id = x."roleId"
        WHERE x."clinicId" = v_member."clinicId" AND r.key = 'ADMINISTRATOR' AND x.status = 'ACTIVE' AND x.id <> v_member.id) THEN
    RAISE EXCEPTION 'member access: LAST_ADMIN' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.member_permission_overrides WHERE "membershipId" = v_member.id;
  UPDATE public.clinic_memberships SET "roleId" = v_new_role, "updatedAt" = now() WHERE id = v_member.id;
END;
$$;

REVOKE ALL ON FUNCTION app.lock_manageable_membership(uuid), app.set_member_permissions(uuid, text[], text[]), app.change_member_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_member_permissions(uuid, text[], text[]), app.change_member_role(uuid, text) TO sehat_app;

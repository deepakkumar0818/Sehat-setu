-- Membership checks now require the user to be NOT DISABLED (rather than
-- ACTIVE). An INVITED user can never present a verified session — the server
-- only sets app.user_id after linking their Supabase login, which also marks
-- them ACTIVE — while disabling a user still cuts off access immediately.
-- Bodies are otherwise identical to 20261013000000_record_access_and_audit.

CREATE OR REPLACE FUNCTION app.is_clinic_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status <> 'DISABLED'
  )
$$;

CREATE OR REPLACE FUNCTION app.is_staff_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.roles r ON r.id = m."roleId"
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status <> 'DISABLED'
      AND r.key <> 'PATIENT'
      AND (m."branchId" IS NULL OR m."branchId" = app.current_branch_id())
  )
$$;

CREATE OR REPLACE FUNCTION app.staff_can(keys text[]) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.roles r ON r.id = m."roleId"
    JOIN public.role_permissions rp ON rp."roleId" = r.id
    JOIN public.permissions p ON p.id = rp."permissionId"
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status <> 'DISABLED'
      AND r.key <> 'PATIENT'
      AND (m."branchId" IS NULL OR m."branchId" = app.current_branch_id())
      AND p.key = ANY (keys)
  )
$$;

CREATE OR REPLACE FUNCTION app.current_patient_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT coalesce(array_agg(p.id), '{}')
  FROM public.patients p
  WHERE p."userId" = app.current_user_id()
    AND p."clinicId" = app.current_clinic_id()
    AND EXISTS (
      SELECT 1
      FROM public.clinic_memberships m
      JOIN public.roles r ON r.id = m."roleId"
      JOIN public.clinics c ON c.id = m."clinicId"
      JOIN public.users u ON u.id = m."userId"
      WHERE m."userId" = p."userId" AND m."clinicId" = p."clinicId"
        AND r.key = 'PATIENT' AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status <> 'DISABLED'
    )
$$;

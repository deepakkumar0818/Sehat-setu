-- Staff directory: an Administrator can set a staff member's phone number.
--
-- Separate from 20261020000000_staff_invitation_phone (no dependency on it):
-- this adds ONE function and touches no table, column, policy or row.
--
-- Why a function: the phone lives on users.phone, and the runtime role
-- (sehat_app) has only SELECT on users. app.set_staff_phone re-checks, inside
-- the database, everything the API checks:
--   * caller: an active staff member of the pinned clinic holding 'user.update'
--     (Administrators only), within their own branch scope (app.staff_can);
--   * target: a non-patient membership of the SAME clinic, inside the caller's
--     branch scope — anything else is indistinguishable from a missing one;
--   * phone: E.164 ('+919876543210'); the number is never echoed in errors;
--   * users.phone is shared by every clinic the person belongs to, so it is
--     changed only when the person has no membership (or patient record) in
--     any other clinic. Otherwise: 'staff phone: SHARED_ACCOUNT'.
-- Audit: the existing users trigger records that "phone" changed (column name
-- only), plus a 'staff.phone_updated' event without the number.

CREATE FUNCTION app.set_staff_phone(p_membership_id uuid, p_phone text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_branch uuid := app.current_branch_id();
  v_phone  text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_m      public.clinic_memberships%ROWTYPE;
  v_role   text;
BEGIN
  -- P5-PHONE-EDIT-1
  IF app.current_user_id() IS NULL OR v_clinic IS NULL OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['user.update']) THEN
    RAISE EXCEPTION 'staff phone: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'staff phone: INVALID_PHONE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_m FROM public.clinic_memberships m WHERE m.id = p_membership_id FOR UPDATE;
  SELECT r.key::text INTO v_role FROM public.roles r WHERE r.id = v_m."roleId";
  -- Another clinic's or another branch's membership (or a patient's) looks exactly like a missing one.
  IF v_m.id IS NULL OR v_m."clinicId" <> v_clinic OR v_role IS NULL OR v_role = 'PATIENT'
     OR (v_branch IS NOT NULL AND v_m."branchId" IS DISTINCT FROM v_branch) THEN
    RAISE EXCEPTION 'staff phone: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- users.phone is shared across clinics: only change it when no other clinic is involved.
  IF EXISTS (SELECT 1 FROM public.clinic_memberships o WHERE o."userId" = v_m."userId" AND o."clinicId" <> v_clinic)
     OR EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_m."userId" AND p."clinicId" <> v_clinic) THEN
    RAISE EXCEPTION 'staff phone: SHARED_ACCOUNT' USING ERRCODE = '55000';
  END IF;

  UPDATE public.users SET phone = v_phone, "updatedAt" = pg_catalog.now()
   WHERE id = v_m."userId" AND phone IS DISTINCT FROM v_phone;
  IF FOUND THEN
    PERFORM app.log_event('staff.phone_updated', 'SUCCESS', 'clinic_memberships', v_m.id::text, NULL, NULL, NULL,
      pg_catalog.jsonb_build_object('userId', v_m."userId"));
  END IF;
  RETURN v_m.id;
END
$$;

REVOKE ALL ON FUNCTION app.set_staff_phone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_staff_phone(uuid, text) TO sehat_app;

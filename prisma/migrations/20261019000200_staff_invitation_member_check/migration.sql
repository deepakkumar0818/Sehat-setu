-- P5 fix: app.create_staff_invitation wrongly refused EVERY existing account
-- that has no membership in the inviting clinic with 'ALREADY_MEMBER'.
--
-- Cause: the same-clinic check aggregated over the person's memberships in the
-- clinic (bool_or). An aggregate returns one row even when there are no
-- memberships, so the CASE fell through to 'ALREADY_MEMBER'. Effects: legitimate
-- invitations of existing accounts (e.g. staff of another clinic, or someone
-- invited before) were refused, and the different answer for "account exists
-- elsewhere" vs "new email" revealed whether an email had an account.
--
-- This replaces only that function, with the check written as EXISTS tests;
-- everything else in the body is unchanged. CREATE OR REPLACE keeps the same
-- signature, owner and grants (EXECUTE for sehat_app only; revoked from PUBLIC
-- in 20261019000100, re-asserted below). No table, row or policy is touched.

CREATE OR REPLACE FUNCTION app.create_staff_invitation(
  p_email text, p_name text, p_role_key text, p_branch_id uuid,
  p_specialty_id uuid DEFAULT NULL, p_qualifications text DEFAULT NULL, p_registration_number text DEFAULT NULL,
  p_experience_years integer DEFAULT NULL, p_consultation_fee_paise integer DEFAULT NULL, p_online_consultation boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c_roles  constant text[] := ARRAY['DOCTOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE'];
  v_email  text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name   text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_qual   text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_qualifications, ''), '\s+', ' ', 'g'));
  v_reg    text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_registration_number, ''), '\s+', ' ', 'g'));
  v_clinic uuid := app.current_clinic_id();
  v_role   uuid;
  v_user   uuid;
  v_id     uuid;
  v_kind   text;
BEGIN
  PERFORM app.require_inviter();
  IF p_role_key IS NULL OR NOT (p_role_key = ANY (c_roles)) THEN
    RAISE EXCEPTION 'staff invitation: ROLE_NOT_INVITABLE' USING ERRCODE = '22023';
  END IF;
  SELECT r.id INTO v_role FROM public.roles r WHERE r.key::text = p_role_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff invitation: ROLE_NOT_INVITABLE' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'staff invitation: INVALID_EMAIL' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'staff invitation: INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  -- Branch: required, active, in this clinic, inside the inviter's own scope.
  IF p_branch_id IS NULL OR NOT app.branch_visible(p_branch_id) OR NOT EXISTS (
       SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b."clinicId" = v_clinic AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'staff invitation: INVALID_BRANCH' USING ERRCODE = '22023';
  END IF;

  IF p_role_key = 'DOCTOR' THEN
    IF NOT app.staff_can(ARRAY['doctor.manage']) THEN
      RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
    END IF;
    IF p_specialty_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.specialties s WHERE s.id = p_specialty_id) THEN
      RAISE EXCEPTION 'staff invitation: INVALID_SPECIALTY' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(v_qual) NOT BETWEEN 2 AND 200 OR v_qual ~ '[[:cntrl:]]'
       OR pg_catalog.length(v_reg) NOT BETWEEN 3 AND 40 OR v_reg ~ '[[:cntrl:]]'
       OR p_experience_years IS NULL OR p_experience_years NOT BETWEEN 0 AND 70
       OR p_consultation_fee_paise IS NULL OR p_consultation_fee_paise NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION 'staff invitation: INVALID_DOCTOR_DETAILS' USING ERRCODE = '22023';
    END IF;
  ELSIF p_specialty_id IS NOT NULL OR p_qualifications IS NOT NULL OR p_registration_number IS NOT NULL
        OR p_experience_years IS NOT NULL OR p_consultation_fee_paise IS NOT NULL OR p_online_consultation IS NOT NULL THEN
    RAISE EXCEPTION 'staff invitation: DOCTOR_DETAILS_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  -- Abuse guard: at most 50 new invitations per clinic per hour.
  IF (SELECT pg_catalog.count(*) FROM public.staff_invitations i
      WHERE i."clinicId" = v_clinic AND i."createdAt" > pg_catalog.now() - interval '1 hour') >= 50 THEN
    RAISE EXCEPTION 'staff invitation: RATE_LIMITED' USING ERRCODE = '55000';
  END IF;

  -- One decision per email at a time across all clinics (covers user creation).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:invite:' || v_email, 0));

  IF p_role_key = 'DOCTOR' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:docreg:' || v_clinic::text || ':' || pg_catalog.lower(v_reg), 0));
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d
               WHERE d."clinicId" = v_clinic AND pg_catalog.lower(d."registrationNumber") = pg_catalog.lower(v_reg))
       OR EXISTS (SELECT 1 FROM public.staff_invitation_doctor_details x JOIN public.staff_invitations i ON i.id = x."invitationId"
                  WHERE x."clinicId" = v_clinic AND pg_catalog.lower(x."registrationNumber") = pg_catalog.lower(v_reg) AND i.status = 'PENDING') THEN
      RAISE EXCEPTION 'staff invitation: REGISTRATION_IN_USE' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT u.id INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_email;
  -- Same-clinic facts only (this clinic's admins can already see its memberships).
  -- A patient of this clinic is never converted into staff.
  IF v_user IS NOT NULL THEN
    -- P5-FIX-1: decided with EXISTS. (The original aggregate returned a row even
    -- with no memberships, so every existing account looked like a member.)
    IF EXISTS (SELECT 1 FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
               WHERE m."userId" = v_user AND m."clinicId" = v_clinic AND r.key = 'PATIENT')
       OR EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_user AND p."clinicId" = v_clinic) THEN
      v_kind := 'ALREADY_PATIENT';
    ELSIF EXISTS (SELECT 1 FROM public.clinic_memberships m WHERE m."userId" = v_user AND m."clinicId" = v_clinic) THEN
      v_kind := 'ALREADY_MEMBER';
    END IF;
    IF v_kind IS NOT NULL THEN
      RAISE EXCEPTION 'staff invitation: %', v_kind USING ERRCODE = '23505';
    END IF;
  END IF;
  SELECT i.id INTO v_id FROM public.staff_invitations i
   WHERE i."clinicId" = v_clinic AND i.email = v_email AND i.status = 'PENDING';
  IF FOUND THEN
    RAISE EXCEPTION 'staff invitation: ALREADY_INVITED %', v_id USING ERRCODE = '23505';
  END IF;

  IF v_user IS NULL THEN
    -- New person: an INVITED row for first-sign-in linking (app.link_auth_user).
    -- Audited WITHOUT a clinic, so this clinic's audit trail can't reveal whether
    -- the email already had an account elsewhere (operator-visible only).
    PERFORM pg_catalog.set_config('app.clinic_id', '', true);
    INSERT INTO public.users (id, email, name, status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_email, v_name, 'INVITED', pg_catalog.now())
    RETURNING id INTO v_user;
    PERFORM pg_catalog.set_config('app.clinic_id', v_clinic::text, true);
  END IF;

  INSERT INTO public.staff_invitations (id, "clinicId", "branchId", "roleId", "userId", email, name, "expiresAt",
                                        "deliveryStatus", "sendAttempts", "lastAttemptAt", "invitedByUserId", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_role, v_user, v_email, v_name, pg_catalog.now() + interval '7 days',
          'SENDING', 1, pg_catalog.now(), app.current_user_id(), pg_catalog.now())
  RETURNING id INTO v_id;

  IF p_role_key = 'DOCTOR' THEN
    INSERT INTO public.staff_invitation_doctor_details ("invitationId", "clinicId", "specialtyId", qualifications, "registrationNumber",
                                                        "experienceYears", "consultationFeePaise", "onlineConsultation")
    VALUES (v_id, v_clinic, p_specialty_id, v_qual, v_reg, p_experience_years, p_consultation_fee_paise, coalesce(p_online_consultation, false));
  END IF;

  PERFORM app.log_event('staff.invitation_created', 'SUCCESS', 'staff_invitations', v_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('role', p_role_key, 'branchId', p_branch_id, 'email', app.mask_email(v_email)));
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean) TO sehat_app;

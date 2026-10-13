-- P5: staff invitations carry the invitee's phone number.
--
-- Why a migration: an invitation exists before the person joins, and the
-- runtime role (sehat_app) can't write users or staff_invitations — every write
-- goes through the SECURITY DEFINER functions. So the phone must be stored on
-- the invitation by app.create_staff_invitation, and moved onto the account by
-- app.accept_staff_invitation (the Staff directory shows users.phone).
--
-- 1. staff_invitations.phone: nullable (existing invitations have none; nothing
--    is backfilled), E.164 only ("+919876543210"). Adding a nullable column with
--    no default is a metadata-only change: no existing row is rewritten.
-- 2. app.create_staff_invitation gains a REQUIRED p_phone (5th parameter). The
--    old 10-parameter version is dropped (not overloaded, so calls can't be
--    ambiguous) and re-granted to sehat_app only. Everything else in the body
--    is unchanged from 20261019000200 (including P5-FIX-1).
-- 3. app.accept_staff_invitation copies the phone onto the account when the
--    account has no phone yet. users is shared across clinics, so a phone the
--    person already has (possibly shown by another clinic) is never overwritten.
--
-- The phone is never put into audit metadata, notifications, emails or error
-- messages (the audit trigger records only the NAMES of changed columns).

-- 1. Column ------------------------------------------------------------------
ALTER TABLE public.staff_invitations ADD COLUMN phone TEXT;
ALTER TABLE public.staff_invitations ADD CONSTRAINT staff_invitations_phone_e164
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');

-- 2. Create (now with the phone) ---------------------------------------------
DROP FUNCTION app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean);

CREATE FUNCTION app.create_staff_invitation(
  p_email text, p_name text, p_role_key text, p_branch_id uuid, p_phone text,
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
  v_phone  text := pg_catalog.btrim(coalesce(p_phone, ''));
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
  -- P5-PHONE-1: required, E.164 (the server normalises it; the number is never echoed back).
  IF v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'staff invitation: INVALID_PHONE' USING ERRCODE = '22023';
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

  INSERT INTO public.staff_invitations (id, "clinicId", "branchId", "roleId", "userId", email, name, phone, "expiresAt",
                                        "deliveryStatus", "sendAttempts", "lastAttemptAt", "invitedByUserId", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_role, v_user, v_email, v_name, v_phone, pg_catalog.now() + interval '7 days',
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

REVOKE ALL ON FUNCTION app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean) TO sehat_app;

-- 3. Accept (copies the phone onto an account that has none) ------------------
CREATE OR REPLACE FUNCTION app.accept_staff_invitation(p_id uuid, p_verified_email text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_user       public.users%ROWTYPE;
  v_inv        public.staff_invitations%ROWTYPE;
  v_doc        public.staff_invitation_doctor_details%ROWTYPE;
  v_role       text;
  v_membership uuid;
  v_doctor     uuid;
BEGIN
  SELECT * INTO v_user FROM public.users u
   WHERE u.id = app.current_user_id() AND u."authProviderId" = app.current_auth_user_id();
  IF NOT FOUND OR app.current_auth_user_id() IS NULL OR v_user.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.staff_invitations i WHERE i.id = p_id FOR UPDATE;
  -- Someone else's invitation is indistinguishable from a missing one.
  IF NOT FOUND OR v_inv."userId" <> v_user.id OR v_inv.email <> pg_catalog.lower(v_user.email) THEN
    RAISE EXCEPTION 'staff invitation: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  -- The Supabase-verified email (passed by the server from getUser(), never the client) must match.
  IF p_verified_email IS NULL OR pg_catalog.lower(pg_catalog.btrim(p_verified_email)) <> v_inv.email THEN
    RAISE EXCEPTION 'staff invitation: EMAIL_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status = 'ACCEPTED' THEN
    RETURN v_inv."clinicId"; -- repeat of a successful accept (double click / retry)
  END IF;
  IF v_inv.status <> 'PENDING' THEN
    RAISE EXCEPTION 'staff invitation: REVOKED' USING ERRCODE = '55000';
  END IF;
  IF v_inv."expiresAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'staff invitation: EXPIRED' USING ERRCODE = '55000';
  END IF;
  SELECT r.key::text INTO v_role FROM public.roles r WHERE r.id = v_inv."roleId";
  IF v_role IS NULL OR NOT (v_role = ANY (ARRAY['DOCTOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE'])) THEN
    RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = v_inv."clinicId" AND c.status = 'ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_inv."branchId" AND b."clinicId" = v_inv."clinicId" AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'staff invitation: UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_memberships m WHERE m."userId" = v_user.id AND m."clinicId" = v_inv."clinicId")
     OR EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_user.id AND p."clinicId" = v_inv."clinicId") THEN
    RAISE EXCEPTION 'staff invitation: ALREADY_MEMBER' USING ERRCODE = '23505';
  END IF;
  IF v_role = 'DOCTOR' THEN
    SELECT * INTO v_doc FROM public.staff_invitation_doctor_details x WHERE x."invitationId" = v_inv.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff invitation: UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    -- doctor_profiles.userId is globally unique: one doctor profile per person.
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d WHERE d."userId" = v_user.id) THEN
      RAISE EXCEPTION 'staff invitation: DOCTOR_PROFILE_EXISTS' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d
               WHERE d."clinicId" = v_inv."clinicId" AND pg_catalog.lower(d."registrationNumber") = pg_catalog.lower(v_doc."registrationNumber")) THEN
      RAISE EXCEPTION 'staff invitation: REGISTRATION_IN_USE' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Attribute audit events to the clinic being joined (transaction-local).
  PERFORM pg_catalog.set_config('app.clinic_id', v_inv."clinicId"::text, true);

  INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_inv."clinicId", v_inv."branchId", v_inv."roleId", 'ACTIVE', pg_catalog.now())
  RETURNING id INTO v_membership;

  -- P5-PHONE-1: the phone entered on the invitation becomes the account's phone,
  -- only if it has none (users is shared across clinics: never overwrite).
  IF v_inv.phone IS NOT NULL THEN
    UPDATE public.users SET phone = v_inv.phone, "updatedAt" = pg_catalog.now()
     WHERE id = v_user.id AND (phone IS NULL OR pg_catalog.btrim(phone) = '');
  END IF;

  IF v_role = 'DOCTOR' THEN
    INSERT INTO public.doctor_profiles (id, "userId", "clinicId", "specialtyId", qualifications, "registrationNumber",
                                        "experienceYears", "consultationFeePaise", "onlineConsultation", status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_inv."clinicId", v_doc."specialtyId", v_doc.qualifications, v_doc."registrationNumber",
            v_doc."experienceYears", v_doc."consultationFeePaise", v_doc."onlineConsultation", 'ACTIVE', pg_catalog.now())
    RETURNING id INTO v_doctor;
    INSERT INTO public.doctor_branches ("doctorId", "branchId", "clinicId", "isPrimary")
    VALUES (v_doctor, v_inv."branchId", v_inv."clinicId", true);
  END IF;

  UPDATE public.staff_invitations SET status = 'ACCEPTED', "acceptedAt" = pg_catalog.now(),
         "membershipId" = v_membership, "updatedAt" = pg_catalog.now() WHERE id = v_inv.id;

  PERFORM app.log_event('staff.invitation_accepted', 'SUCCESS', 'staff_invitations', v_inv.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('role', v_role, 'branchId', v_inv."branchId",
      'membershipId', v_membership, 'doctorId', v_doctor)));
  PERFORM app.add_notification(v_inv."clinicId", 'PERSONAL', v_inv."invitedByUserId", NULL, NULL,
    'STAFF_INVITATION_ACCEPTED', v_inv.id, pg_catalog.jsonb_build_object('role', v_role, 'branchId', v_inv."branchId"));
  RETURN v_inv."clinicId";
END
$$;

-- CREATE OR REPLACE keeps accept's owner and grants; re-asserted for clarity.
REVOKE ALL ON FUNCTION app.accept_staff_invitation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_staff_invitation(uuid, text) TO sehat_app;

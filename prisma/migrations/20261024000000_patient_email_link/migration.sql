-- Patient portal: link a self-registered login to its patient record by
-- CONFIRMED EMAIL, replacing the clinic-issued one-time code as the way
-- patients connect (the code functions from 20261022000000 stay, unused).
--
-- * Who: a signed-in Supabase login whose email Supabase has confirmed. The
--   server passes that email (getUser(), email_confirmed_at set); never the
--   browser. The auth id comes from the pinned app.auth_user_id.
-- * Match: exactly ONE ACTIVE, not-yet-linked patient in an ACTIVE clinic whose
--   staff-entered email equals it (case-insensitive). None → NO_MATCH; more than
--   one (e.g. family members sharing an address) → NOT_ELIGIBLE, so the clinic
--   sorts it out — never a guess.
-- * Same account/membership rules as app.redeem_patient_link_code: reuse the
--   login's account, adopt an INVITED row with this email, or create one; never
--   replace an existing link, never re-enable a switched-off membership, never
--   attach a staff account in that clinic.
--
-- result: LINKED | ALREADY_LINKED | NO_MATCH | NOT_ELIGIBLE

CREATE FUNCTION app.link_patient_by_email(p_verified_email text)
  RETURNS TABLE (result text, clinic_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
#variable_conflict use_column
DECLARE
  v_auth       text := app.current_auth_user_id();
  v_email      text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_verified_email, '')));
  v_matches    int;
  v_patient    public.patients%ROWTYPE;
  v_user       public.users%ROWTYPE;
  v_role       uuid;
  v_member     public.clinic_memberships%ROWTYPE;
  v_reason     text;
  v_new_user   boolean := false;
  v_new_member boolean := false;
BEGIN
  IF v_auth IS NULL OR pg_catalog.length(v_auth) > 128 THEN
    RAISE EXCEPTION 'patient link: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'patient link: EMAIL_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:patient-link:' || v_auth, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:invite:' || v_email, 0));

  -- Already linked (repeat visit, double request): nothing to do.
  SELECT * INTO v_user FROM public.users u WHERE u."authProviderId" = v_auth FOR UPDATE;
  IF v_user.id IS NOT NULL THEN
    SELECT * INTO v_patient FROM public.patients p WHERE p."userId" = v_user.id LIMIT 1;
    IF v_patient.id IS NOT NULL THEN
      RETURN QUERY SELECT 'ALREADY_LINKED'::text, v_patient."clinicId";
      RETURN;
    END IF;
  END IF;

  SELECT pg_catalog.count(*) INTO v_matches
    FROM public.patients p JOIN public.clinics c ON c.id = p."clinicId"
   WHERE pg_catalog.lower(pg_catalog.btrim(p.email)) = v_email
     AND p.status = 'ACTIVE' AND p."userId" IS NULL AND c.status = 'ACTIVE';
  IF v_matches = 0 THEN
    RETURN QUERY SELECT 'NO_MATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT p.* INTO v_patient
    FROM public.patients p JOIN public.clinics c ON c.id = p."clinicId"
   WHERE pg_catalog.lower(pg_catalog.btrim(p.email)) = v_email
     AND p.status = 'ACTIVE' AND p."userId" IS NULL AND c.status = 'ACTIVE'
   LIMIT 1
   FOR UPDATE OF p;

  IF v_matches > 1 THEN
    v_reason := 'ambiguous_email';
  END IF;
  IF v_reason IS NULL AND v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_email FOR UPDATE;
    IF v_user.id IS NOT NULL AND NOT (v_user."authProviderId" IS NULL AND v_user.status = 'INVITED') THEN
      v_reason := 'email_in_use';
    END IF;
  END IF;
  SELECT r.id INTO v_role FROM public.roles r WHERE r.key = 'PATIENT';

  IF v_reason IS NOT NULL THEN
    NULL;
  ELSIF v_role IS NULL THEN
    v_reason := 'no_patient_role';
  ELSIF v_user.id IS NOT NULL AND v_user."authProviderId" IS NOT NULL AND v_user.status <> 'ACTIVE' THEN
    v_reason := 'account_disabled';
  ELSIF v_user.id IS NOT NULL AND v_user.status = 'DISABLED' THEN
    v_reason := 'account_disabled';
  ELSIF v_user.id IS NOT NULL AND pg_catalog.lower(v_user.email) <> v_email THEN
    v_reason := 'email_mismatch';
  ELSIF v_user.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
           WHERE m."userId" = v_user.id AND m."clinicId" = v_patient."clinicId" AND r.key <> 'PATIENT') THEN
    v_reason := 'staff_account';
  END IF;
  IF v_reason IS NULL AND v_user.id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.clinic_memberships m
     WHERE m."userId" = v_user.id AND m."clinicId" = v_patient."clinicId" AND m."roleId" = v_role FOR UPDATE;
    IF v_member.id IS NOT NULL AND v_member.status <> 'ACTIVE' THEN
      v_reason := 'membership_inactive'; -- the clinic switched this portal access off: never silently re-enabled
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- An ambiguous match names no single clinic: operator-visible only.
    PERFORM pg_catalog.set_config('app.clinic_id', CASE WHEN v_reason = 'ambiguous_email' THEN '' ELSE v_patient."clinicId"::text END, true);
    PERFORM pg_catalog.set_config('app.user_id', coalesce(v_user.id::text, ''), true);
    PERFORM app.log_event('patient.email_link_failed', 'DENIED', 'patients',
      CASE WHEN v_reason = 'ambiguous_email' THEN NULL ELSE v_patient.id::text END, v_reason, NULL, NULL, NULL);
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.clinic_id', '', true);
  IF v_user.id IS NULL THEN
    INSERT INTO public.users (id, email, name, status, "authProviderId", "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_email, v_patient.name, 'ACTIVE', v_auth, pg_catalog.now())
    RETURNING * INTO v_user;
    v_new_user := true;
  ELSIF v_user."authProviderId" IS NULL THEN
    UPDATE public.users SET "authProviderId" = v_auth, status = 'ACTIVE', "updatedAt" = pg_catalog.now()
     WHERE id = v_user.id AND "authProviderId" IS NULL AND status = 'INVITED'
    RETURNING * INTO v_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'patient link: CONFLICT' USING ERRCODE = '40001';
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.user_id', v_user.id::text, true);
  PERFORM pg_catalog.set_config('app.clinic_id', v_patient."clinicId"::text, true);
  IF v_member.id IS NULL THEN
    INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_patient."clinicId", NULL, v_role, 'ACTIVE', pg_catalog.now());
    v_new_member := true;
  END IF;

  UPDATE public.patients SET "userId" = v_user.id, "updatedAt" = pg_catalog.now()
   WHERE id = v_patient.id AND "userId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient link: CONFLICT' USING ERRCODE = '40001'; -- never overwrite
  END IF;

  PERFORM app.log_event('patient.portal_linked', 'SUCCESS', 'patients', v_patient.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('method', 'email', 'accountCreated', v_new_user, 'membershipCreated', v_new_member));
  RETURN QUERY SELECT 'LINKED'::text, v_patient."clinicId";
END
$$;

REVOKE ALL ON FUNCTION app.link_patient_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.link_patient_by_email(text) TO sehat_app;

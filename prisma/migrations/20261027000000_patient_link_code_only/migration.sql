-- Patient linking: EXISTING clinic records link only with the staff-issued
-- single-use code (app.redeem_patient_link_code, 20261022000000). Matching an
-- existing record by email is switched off: a confirmed email is not proof of
-- identity (mail scanners can follow a confirmation link without the owner,
-- so a stranger who registered someone else's address could otherwise be
-- linked to that person's records).
--
-- * app.link_patient_by_email (20261024000000) is no longer callable by the
--   runtime role. It remains only as an internal step of
--   app.register_self_patient, for the record that function has just created.
-- * app.register_self_patient (replaces 20261026000000's body; same signature):
--     already linked                          → ALREADY_LINKED
--     ANY patient record carries this email   → NEEDS_CODE (nothing created or
--                                                linked; the clinic issues a code)
--     otherwise                                → creates the record in the
--                                                configured clinic and links it
--                                                → LINKED (or NOT_ELIGIBLE)
--
-- result: LINKED | ALREADY_LINKED | NEEDS_CODE | NOT_ELIGIBLE  ('patient link: INVALID_INPUT' on bad details)

REVOKE EXECUTE ON FUNCTION app.link_patient_by_email(text) FROM sehat_app;

DROP FUNCTION app.register_self_patient(text, text, text, text, date, text);

CREATE FUNCTION app.register_self_patient(p_clinic_code text, p_verified_email text, p_name text, p_phone text, p_date_of_birth date, p_gender text)
  RETURNS TABLE (result text, clinic_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
#variable_conflict use_column
DECLARE
  v_auth    text := app.current_auth_user_id();
  v_code    text := NULLIF(pg_catalog.btrim(coalesce(p_clinic_code, '')), '');
  v_email   text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_verified_email, '')));
  v_name    text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone   text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_gender  text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_gender, '')));
  v_linked  public.patients%ROWTYPE;
  v_clinic  public.clinics%ROWTYPE;
  v_branch  uuid;
  v_prefix  text;
  v_last    text;
  v_n       int := 1;
  v_patient uuid;
BEGIN
  IF v_auth IS NULL OR pg_catalog.length(v_auth) > 128 THEN
    RAISE EXCEPTION 'patient link: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'patient link: EMAIL_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;
  -- Same locks as the link functions: one decision per login and per address at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:patient-link:' || v_auth, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:invite:' || v_email, 0));

  SELECT p.* INTO v_linked FROM public.patients p JOIN public.users u ON u.id = p."userId"
   WHERE u."authProviderId" = v_auth LIMIT 1;
  IF v_linked.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_LINKED'::text, v_linked."clinicId";
    RETURN;
  END IF;

  -- A record with this email already exists (any clinic, any status, linked or
  -- not): never create a duplicate and never link it here — that takes the code.
  IF EXISTS (SELECT 1 FROM public.patients p WHERE pg_catalog.lower(pg_catalog.btrim(p.email)) = v_email) THEN
    PERFORM pg_catalog.set_config('app.clinic_id', '', true);
    PERFORM pg_catalog.set_config('app.user_id', '', true);
    PERFORM app.log_event('patient.self_register_failed', 'DENIED', NULL, NULL, 'existing_record_needs_code', NULL, NULL, NULL);
    RETURN QUERY SELECT 'NEEDS_CODE'::text, NULL::uuid;
    RETURN;
  END IF;

  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120
     OR v_phone !~ '^\+?[0-9][0-9 ()-]{4,29}$'
     OR p_date_of_birth IS NULL OR p_date_of_birth < DATE '1900-01-01' OR p_date_of_birth > CURRENT_DATE
     OR v_gender NOT IN ('MALE', 'FEMALE', 'OTHER') THEN
    RAISE EXCEPTION 'patient link: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  -- Store the number in E.164 like staff-entered numbers (src/lib/phone.ts):
  -- separators removed; a bare 10-digit number is an Indian mobile (+91).
  v_phone := pg_catalog.regexp_replace(v_phone, '[[:space:]().-]', '', 'g');
  IF v_phone ~ '^[0-9]{10}$' THEN
    v_phone := '+91' || v_phone;
  END IF;

  IF v_code IS NOT NULL THEN
    SELECT * INTO v_clinic FROM public.clinics c WHERE pg_catalog.upper(c.code) = pg_catalog.upper(v_code) AND c.status = 'ACTIVE';
    IF v_clinic.id IS NULL THEN
      PERFORM app.log_event('patient.self_register_failed', 'DENIED', NULL, NULL, 'configured_clinic_unavailable', NULL, NULL, NULL);
      RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
  ELSE
    IF (SELECT pg_catalog.count(*) FROM public.clinics c WHERE c.status = 'ACTIVE') <> 1 THEN
      PERFORM app.log_event('patient.self_register_failed', 'DENIED', NULL, NULL, 'no_single_clinic', NULL, NULL, NULL);
      RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO v_clinic FROM public.clinics c WHERE c.status = 'ACTIVE';
  END IF;

  SELECT b.id INTO v_branch FROM public.branches b
   WHERE b."clinicId" = v_clinic.id AND b.status = 'ACTIVE'
   ORDER BY b."isHeadOffice" DESC, b."createdAt", b.id LIMIT 1;
  PERFORM pg_catalog.set_config('app.clinic_id', v_clinic.id::text, true);
  PERFORM pg_catalog.set_config('app.user_id', '', true);
  IF v_branch IS NULL THEN
    PERFORM app.log_event('patient.self_register_failed', 'DENIED', NULL, NULL, 'no_active_branch', NULL, NULL, NULL);
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Refuse up front whatever the attach step below would refuse, so a refusal
  -- never leaves a record behind: the address belongs to another account, this
  -- login's account is not ACTIVE, or it is staff in this clinic.
  IF EXISTS (SELECT 1 FROM public.users u WHERE pg_catalog.lower(u.email) = v_email
               AND u."authProviderId" IS DISTINCT FROM v_auth AND NOT (u."authProviderId" IS NULL AND u.status = 'INVITED'))
     OR EXISTS (SELECT 1 FROM public.users u WHERE u."authProviderId" = v_auth AND (u.status <> 'ACTIVE' OR pg_catalog.lower(u.email) <> v_email))
     OR EXISTS (SELECT 1 FROM public.users u JOIN public.clinic_memberships m ON m."userId" = u.id JOIN public.roles r ON r.id = m."roleId"
                 WHERE u."authProviderId" = v_auth AND m."clinicId" = v_clinic.id AND (r.key <> 'PATIENT' OR m.status <> 'ACTIVE')) THEN
    PERFORM app.log_event('patient.self_register_failed', 'DENIED', NULL, NULL, 'account_not_eligible', NULL, NULL, NULL);
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Same numbering and lock as staff-created patients (src/server/data/patients.ts).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('patient-number:' || v_clinic.id::text));
  v_prefix := v_clinic.code || '-P-';
  SELECT p."patientNumber" INTO v_last FROM public.patients p
   WHERE p."clinicId" = v_clinic.id AND pg_catalog.starts_with(p."patientNumber", v_prefix)
   ORDER BY p."patientNumber" DESC LIMIT 1;
  IF v_last IS NOT NULL AND pg_catalog.substr(v_last, pg_catalog.length(v_prefix) + 1) ~ '^[0-9]{1,9}$' THEN
    v_n := pg_catalog.substr(v_last, pg_catalog.length(v_prefix) + 1)::int + 1;
  END IF;

  INSERT INTO public.patients (id, "clinicId", "branchId", "patientNumber", name, "dateOfBirth", gender, phone, email,
                               allergies, "chronicConditions", status, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic.id, v_branch, v_prefix || pg_catalog.lpad(v_n::text, 4, '0'), v_name,
          p_date_of_birth, v_gender::public."Gender", v_phone, v_email, '{}', '{}', 'ACTIVE', pg_catalog.now())
  RETURNING id INTO v_patient;
  PERFORM app.log_event('patient.self_registered', 'SUCCESS', 'patients', v_patient::text, NULL, NULL, NULL, NULL);

  -- Attach the login to the record just created. It is the ONLY record with this
  -- address (checked above, under the address lock), so this cannot reach any other.
  RETURN QUERY SELECT l.result, l.clinic_id FROM app.link_patient_by_email(v_email) l WHERE l.result = 'LINKED';
  IF NOT FOUND THEN
    -- Unreachable after the checks above; roll the new record back rather than leave it unlinked.
    RAISE EXCEPTION 'patient link: CONFLICT' USING ERRCODE = '40001';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.register_self_patient(text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_self_patient(text, text, text, text, date, text) TO sehat_app;

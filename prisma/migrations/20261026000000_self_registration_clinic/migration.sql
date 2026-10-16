-- Self-registration: the clinic for NEW self-registered patients is chosen by
-- the operator (server setting SELF_REGISTRATION_CLINIC = a clinic code), never
-- by the patient. Replaces app.register_self_patient (20261025000000) with a
-- version taking that code first; everything else is unchanged.
--
-- * p_clinic_code set   → that clinic, which must be ACTIVE (else NOT_ELIGIBLE,
--                          reason 'configured_clinic_unavailable').
-- * p_clinic_code null  → the single ACTIVE clinic, as before (more than one
--                          → NOT_ELIGIBLE 'no_single_clinic': never a guess).
-- An existing record with the patient's email is still linked first, in
-- whichever clinic it is; nothing is created then.

DROP FUNCTION app.register_self_patient(text, text, text, date, text);

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
  v_link    record;
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

  -- An existing record with this email always wins: link it, create nothing.
  SELECT * INTO v_link FROM app.link_patient_by_email(v_email);
  IF v_link.result <> 'NO_MATCH' THEN
    RETURN QUERY SELECT v_link.result, v_link.clinic_id;
    RETURN;
  END IF;

  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120
     OR v_phone !~ '^\+?[0-9][0-9 ()-]{4,29}$'
     OR p_date_of_birth IS NULL OR p_date_of_birth < DATE '1900-01-01' OR p_date_of_birth > CURRENT_DATE
     OR v_gender NOT IN ('MALE', 'FEMALE', 'OTHER') THEN
    RAISE EXCEPTION 'patient link: INVALID_INPUT' USING ERRCODE = '22023';
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

  RETURN QUERY SELECT l.result, l.clinic_id FROM app.link_patient_by_email(v_email) l;
END
$$;

REVOKE ALL ON FUNCTION app.register_self_patient(text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_self_patient(text, text, text, text, date, text) TO sehat_app;

-- P6.5: first-login patient onboarding — PATIENT-REPORTED profile, medical
-- history and pre-visit symptoms.
--
-- * Who: a signed-in patient in the portal, i.e. a login that already holds an
--   ACTIVE PATIENT membership and a patients.userId link made by the clinic's
--   linking code (20261022000000). Nothing here creates, changes or relaxes
--   any link or membership: every function takes the patient ONLY from
--   app.current_patient_ids() (pinned user + clinic, ACTIVE membership) and
--   refuses unless that is exactly one ACTIVE patient record.
-- * What: two NEW tables. The clinic's own patient record (public.patients:
--   staff-entered, identity-checked) is never read for writing and never
--   updated: the patient's answers are kept separately, as patient-reported,
--   for the clinic to review.
--     patient_intake_profiles  one row per patient record: personal details,
--                              emergency contact, medical history, and the
--                              onboarding progress timestamps (the trusted,
--                              server-side completion state).
--     patient_symptom_reports  APPEND-ONLY pre-visit questionnaires. A new
--                              answer never overwrites an earlier one. The
--                              optional appointment must be the caller's own
--                              upcoming appointment (checked here, in the same
--                              clinic). Never a diagnosis.
-- * Allergy status is explicit: NOT_ANSWERED (default), UNKNOWN (not yet
--   confirmed), NONE_KNOWN ("no known allergies") or HAS_ALLERGIES (then the
--   list is non-empty). An empty list alone means nothing.
-- * Access: the runtime role gets SELECT only, through RLS: the patient's own
--   rows, or staff under the existing MEDICAL-RECORD rules
--   (app.patient_reported_visible): medical_record.view/manage within the
--   caller's branch scope (the patient's registration branch), or a doctor
--   holding patient.medical_record.view who has an appointment with the
--   patient. Receptionists, nurses, lab and billing staff hold neither
--   permission and see nothing. All writes go through the SECURITY DEFINER
--   functions below; no INSERT/UPDATE/DELETE grants.
-- * Duplicate submissions: profile saves are idempotent upserts; a symptom
--   report carries a client request id (unique per patient) and a repeat
--   returns the first report. At most 20 symptom reports per patient per day.
-- * Audit: app.log_event rows carry ids and flags only — never names, dates
--   of birth, phone numbers, allergies, medications or symptoms; row triggers
--   record changed COLUMN NAMES only (app.audit_row_change).
-- * Additive only: no existing table, row, policy, grant or function is
--   modified or dropped.

-- 1. Types --------------------------------------------------------------------
CREATE TYPE "IntakeAllergyStatus" AS ENUM ('NOT_ANSWERED', 'UNKNOWN', 'NONE_KNOWN', 'HAS_ALLERGIES');
CREATE TYPE "SymptomOnset" AS ENUM ('TODAY', 'DAYS_1_3', 'DAYS_4_7', 'WEEKS_1_4', 'OVER_1_MONTH', 'UNSURE');
CREATE TYPE "SymptomSeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');

-- 2. Shape check for the repeatable entries (allergies, medications) ----------
--    An array of at most 30 objects; each has the required string key
--    (1-120 characters) and only the listed optional keys (string or null,
--    at most 120 characters). Used by CHECK constraints and the functions.
CREATE FUNCTION app.intake_items_valid(p_items jsonb, p_required text, p_optional text[]) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS
$$
DECLARE
  v jsonb;
  k text;
BEGIN
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) > 30 THEN
    RETURN false;
  END IF;
  FOR v IN SELECT e FROM pg_catalog.jsonb_array_elements(p_items) AS e LOOP
    IF pg_catalog.jsonb_typeof(v) <> 'object'
       OR pg_catalog.jsonb_typeof(v -> p_required) IS DISTINCT FROM 'string'
       OR pg_catalog.length(pg_catalog.btrim(v ->> p_required)) NOT BETWEEN 1 AND 120 THEN
      RETURN false;
    END IF;
    FOR k IN SELECT pg_catalog.jsonb_object_keys(v) LOOP
      IF k <> p_required THEN
        IF NOT (k = ANY (p_optional)) OR pg_catalog.jsonb_typeof(v -> k) NOT IN ('string', 'null') THEN
          RETURN false;
        END IF;
        IF pg_catalog.jsonb_typeof(v -> k) = 'string' AND pg_catalog.length(v ->> k) > 120 THEN
          RETURN false;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION app.intake_items_valid(jsonb, text, text[]) FROM PUBLIC;

-- 3. Tables -------------------------------------------------------------------
CREATE TABLE "patient_intake_profiles" (
  "id"                           UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"                     UUID NOT NULL,
  "patientId"                    UUID NOT NULL,
  -- Step 1: personal (patient-reported; the clinic's record is unchanged)
  "legalName"                    TEXT NOT NULL,
  "dateOfBirth"                  DATE NOT NULL,
  "gender"                       "Gender",
  "phone"                        TEXT NOT NULL,
  "addressLine"                  TEXT NOT NULL,
  "city"                         TEXT NOT NULL,
  "state"                        TEXT,
  "postalCode"                   TEXT,
  "emergencyContactName"         TEXT,
  "emergencyContactRelationship" TEXT,
  "emergencyContactPhone"        TEXT,
  -- Step 2: medical history (patient-reported; never a clinician-confirmed diagnosis)
  "allergyStatus"                "IntakeAllergyStatus" NOT NULL DEFAULT 'NOT_ANSWERED',
  "allergies"                    JSONB NOT NULL DEFAULT '[]',
  "medications"                  JSONB NOT NULL DEFAULT '[]',
  "conditions"                   TEXT[] NOT NULL DEFAULT '{}',
  "pastSurgeries"                TEXT,
  "familyHistory"                TEXT,
  -- Progress (the server-side source of truth for the onboarding popup)
  "personalSavedAt"              TIMESTAMPTZ(6) NOT NULL,
  "medicalReviewedAt"            TIMESTAMPTZ(6),
  "completedAt"                  TIMESTAMPTZ(6),
  "reportedByUserId"             UUID NOT NULL,
  "createdAt"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "patient_intake_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_intake_profiles_patientId_key" UNIQUE ("patientId"),
  CONSTRAINT "patient_intake_profiles_clinicId_patientId_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "patients"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_intake_profiles_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_intake_profiles_legal_name" CHECK (pg_catalog.length(pg_catalog.btrim("legalName")) BETWEEN 1 AND 200),
  CONSTRAINT "patient_intake_profiles_dob_floor" CHECK ("dateOfBirth" >= DATE '1900-01-01'),
  CONSTRAINT "patient_intake_profiles_phone" CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT "patient_intake_profiles_emergency_phone" CHECK ("emergencyContactPhone" IS NULL OR "emergencyContactPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT "patient_intake_profiles_text_lengths" CHECK (
    pg_catalog.length("addressLine") BETWEEN 1 AND 300 AND pg_catalog.length("city") BETWEEN 1 AND 100
    AND coalesce(pg_catalog.length("state"), 0) <= 100 AND coalesce(pg_catalog.length("postalCode"), 0) <= 20
    AND coalesce(pg_catalog.length("emergencyContactName"), 0) <= 120 AND coalesce(pg_catalog.length("emergencyContactRelationship"), 0) <= 60
    AND coalesce(pg_catalog.length("pastSurgeries"), 0) <= 2000 AND coalesce(pg_catalog.length("familyHistory"), 0) <= 2000),
  CONSTRAINT "patient_intake_profiles_allergies" CHECK (
    app.intake_items_valid("allergies", 'substance', ARRAY['reaction'])
    AND (("allergyStatus" = 'HAS_ALLERGIES') = (pg_catalog.jsonb_array_length("allergies") > 0))),
  CONSTRAINT "patient_intake_profiles_medications" CHECK (app.intake_items_valid("medications", 'name', ARRAY['dose', 'frequency'])),
  CONSTRAINT "patient_intake_profiles_conditions" CHECK (pg_catalog.cardinality("conditions") <= 30),
  CONSTRAINT "patient_intake_profiles_progress" CHECK ("completedAt" IS NULL OR "medicalReviewedAt" IS NOT NULL)
);
CREATE INDEX "patient_intake_profiles_clinicId_idx" ON "patient_intake_profiles"("clinicId");

CREATE TABLE "patient_symptom_reports" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"         UUID NOT NULL,
  "patientId"        UUID NOT NULL,
  "appointmentId"    UUID,
  "requestId"        UUID NOT NULL,
  "reason"           TEXT NOT NULL,
  "symptoms"         TEXT NOT NULL,
  "onset"            "SymptomOnset" NOT NULL,
  "severity"         "SymptomSeverity",
  "notes"            TEXT,
  "reportedByUserId" UUID NOT NULL,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "patient_symptom_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_symptom_reports_clinicId_patientId_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "patients"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_symptom_reports_clinicId_appointmentId_fkey" FOREIGN KEY ("clinicId", "appointmentId") REFERENCES "appointments"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_symptom_reports_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_symptom_reports_request_key" UNIQUE ("patientId", "requestId"),
  CONSTRAINT "patient_symptom_reports_text_lengths" CHECK (
    pg_catalog.length(pg_catalog.btrim("reason")) BETWEEN 1 AND 300 AND pg_catalog.length(pg_catalog.btrim("symptoms")) BETWEEN 1 AND 2000
    AND coalesce(pg_catalog.length("notes"), 0) <= 2000)
);
CREATE INDEX "patient_symptom_reports_clinicId_patientId_createdAt_idx" ON "patient_symptom_reports"("clinicId", "patientId", "createdAt");
CREATE INDEX "patient_symptom_reports_appointmentId_idx" ON "patient_symptom_reports"("appointmentId");

-- 4. Row-level security: SELECT only for the runtime role ----------------------
ALTER TABLE "patient_intake_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_symptom_reports" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON patient_intake_profiles, patient_symptom_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON patient_intake_profiles, patient_symptom_reports TO sehat_app;

-- Staff visibility of a patient's patient-reported answers: the existing
-- medical-record permissions, with the same branch and doctor-assignment
-- rules as clinical records (cf. app.clinical_record_visible, 20261021000000),
-- but WITHOUT its lab_report.view clause (lab and nursing staff don't get
-- medical history). SECURITY DEFINER so the patient's branch is read whatever
-- the caller's patients policy allows; it only answers true/false.
CREATE FUNCTION app.patient_reported_visible(p_patient_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT app.is_staff_member() AND EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p."clinicId" = app.current_clinic_id()
       AND (
         (app.staff_can(ARRAY['medical_record.view', 'medical_record.manage']) AND app.branch_visible(p."branchId"))
         OR (app.current_doctor_id() IS NOT NULL AND app.staff_can(ARRAY['patient.medical_record.view'])
             AND EXISTS (SELECT 1 FROM public.appointments a
                          WHERE a."clinicId" = app.current_clinic_id() AND a."patientId" = p.id AND a."doctorId" = app.current_doctor_id()))
       )
  )
$$;
REVOKE ALL ON FUNCTION app.patient_reported_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.patient_reported_visible(uuid) TO sehat_app;

CREATE POLICY patient_intake_profiles_read ON patient_intake_profiles FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (
    "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
    OR app.patient_reported_visible("patientId")
  )
);
CREATE POLICY patient_symptom_reports_read ON patient_symptom_reports FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (
    "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
    OR app.patient_reported_visible("patientId")
  )
);

CREATE TRIGGER audit_patient_intake_profiles AFTER INSERT OR UPDATE OR DELETE ON patient_intake_profiles
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_patient_symptom_reports AFTER INSERT OR UPDATE OR DELETE ON patient_symptom_reports
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- 5. Functions -------------------------------------------------------------------
-- The caller's ONE linked, ACTIVE patient record in the pinned clinic, or a refusal.
CREATE FUNCTION app.intake_current_patient() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_ids uuid[] := app.current_patient_ids();
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL OR pg_catalog.cardinality(v_ids) <> 1 THEN
    RAISE EXCEPTION 'patient intake: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_ids[1] AND p."clinicId" = app.current_clinic_id() AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'patient intake: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  RETURN v_ids[1];
END
$$;
REVOKE ALL ON FUNCTION app.intake_current_patient() FROM PUBLIC;

CREATE FUNCTION app.intake_e164(p text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT p ~ '^\+[1-9][0-9]{6,14}$' $$;
REVOKE ALL ON FUNCTION app.intake_e164(text) FROM PUBLIC;

-- Step 1. Upsert of the patient's own personal details. Never touches public.patients.
CREATE FUNCTION app.save_patient_intake_personal(
  p_legal_name text, p_date_of_birth date, p_gender text, p_phone text,
  p_address_line text, p_city text, p_state text, p_postal_code text,
  p_emergency_name text, p_emergency_relationship text, p_emergency_phone text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.intake_current_patient();
  v_clinic uuid := app.current_clinic_id();
  v_name text := pg_catalog.btrim(p_legal_name);
  v_address text := pg_catalog.btrim(p_address_line);
  v_city text := pg_catalog.btrim(p_city);
  v_state text := NULLIF(pg_catalog.btrim(p_state), '');
  v_postal text := NULLIF(pg_catalog.btrim(p_postal_code), '');
  v_ec_name text := NULLIF(pg_catalog.btrim(p_emergency_name), '');
  v_ec_rel text := NULLIF(pg_catalog.btrim(p_emergency_relationship), '');
  v_ec_phone text := NULLIF(pg_catalog.btrim(p_emergency_phone), '');
BEGIN
  IF v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 1 AND 200
     -- "today" in the application's time zone (IST), like the app's own validation
     OR p_date_of_birth IS NULL OR p_date_of_birth < DATE '1900-01-01' OR p_date_of_birth > (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date
     OR (p_gender IS NOT NULL AND p_gender NOT IN ('MALE', 'FEMALE', 'OTHER'))
     OR p_phone IS NULL OR NOT app.intake_e164(p_phone)
     OR v_address IS NULL OR pg_catalog.length(v_address) NOT BETWEEN 1 AND 300
     OR v_city IS NULL OR pg_catalog.length(v_city) NOT BETWEEN 1 AND 100
     OR coalesce(pg_catalog.length(v_state), 0) > 100
     OR (v_postal IS NOT NULL AND v_postal !~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$')
     OR coalesce(pg_catalog.length(v_ec_name), 0) > 120 OR coalesce(pg_catalog.length(v_ec_rel), 0) > 60
     OR (v_ec_phone IS NOT NULL AND NOT app.intake_e164(v_ec_phone))
     -- an emergency contact needs both a name and a phone number (or neither)
     OR ((v_ec_name IS NULL) <> (v_ec_phone IS NULL))
     OR (v_ec_rel IS NOT NULL AND v_ec_name IS NULL) THEN
    RAISE EXCEPTION 'patient intake: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.patient_intake_profiles AS t
    ("clinicId", "patientId", "legalName", "dateOfBirth", gender, phone, "addressLine", city, state, "postalCode",
     "emergencyContactName", "emergencyContactRelationship", "emergencyContactPhone", "personalSavedAt", "reportedByUserId")
  VALUES (v_clinic, v_patient, v_name, p_date_of_birth, p_gender::public."Gender", p_phone, v_address, v_city, v_state, v_postal,
          v_ec_name, v_ec_rel, v_ec_phone, pg_catalog.now(), app.current_user_id())
  ON CONFLICT ("patientId") DO UPDATE SET
    "legalName" = EXCLUDED."legalName", "dateOfBirth" = EXCLUDED."dateOfBirth", gender = EXCLUDED.gender, phone = EXCLUDED.phone,
    "addressLine" = EXCLUDED."addressLine", city = EXCLUDED.city, state = EXCLUDED.state, "postalCode" = EXCLUDED."postalCode",
    "emergencyContactName" = EXCLUDED."emergencyContactName", "emergencyContactRelationship" = EXCLUDED."emergencyContactRelationship",
    "emergencyContactPhone" = EXCLUDED."emergencyContactPhone", "personalSavedAt" = pg_catalog.now(),
    "reportedByUserId" = EXCLUDED."reportedByUserId", "updatedAt" = pg_catalog.now()
  WHERE t."clinicId" = v_clinic;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient intake: NOT_PERMITTED' USING ERRCODE = '42501'; -- unreachable: (clinicId, patientId) is one record
  END IF;
  PERFORM app.log_event('patient_intake.personal_saved', 'SUCCESS', 'patients', v_patient::text, NULL, NULL, NULL, NULL);
END
$$;

-- Step 2. Replaces the patient-reported medical history (requires step 1).
CREATE FUNCTION app.save_patient_intake_medical(
  p_allergy_status text, p_allergies jsonb, p_medications jsonb, p_conditions text[], p_past_surgeries text, p_family_history text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.intake_current_patient();
  v_conditions text[];
  v_surgeries text := NULLIF(pg_catalog.btrim(p_past_surgeries), '');
  v_family text := NULLIF(pg_catalog.btrim(p_family_history), '');
BEGIN
  SELECT coalesce(array_agg(pg_catalog.btrim(c)), '{}') INTO v_conditions
    FROM pg_catalog.unnest(coalesce(p_conditions, '{}')) AS c WHERE pg_catalog.btrim(c) <> '';
  IF p_allergy_status IS NULL OR p_allergy_status NOT IN ('NOT_ANSWERED', 'UNKNOWN', 'NONE_KNOWN', 'HAS_ALLERGIES')
     OR NOT app.intake_items_valid(p_allergies, 'substance', ARRAY['reaction'])
     OR ((p_allergy_status = 'HAS_ALLERGIES') <> (pg_catalog.jsonb_array_length(p_allergies) > 0))
     OR NOT app.intake_items_valid(p_medications, 'name', ARRAY['dose', 'frequency'])
     OR pg_catalog.cardinality(v_conditions) > 30
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_conditions) AS c WHERE pg_catalog.length(c) > 120)
     OR coalesce(pg_catalog.length(v_surgeries), 0) > 2000 OR coalesce(pg_catalog.length(v_family), 0) > 2000 THEN
    RAISE EXCEPTION 'patient intake: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  UPDATE public.patient_intake_profiles
     SET "allergyStatus" = p_allergy_status::public."IntakeAllergyStatus", allergies = p_allergies, medications = p_medications,
         conditions = v_conditions, "pastSurgeries" = v_surgeries, "familyHistory" = v_family,
         "medicalReviewedAt" = pg_catalog.now(), "reportedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now()
   WHERE "patientId" = v_patient AND "clinicId" = app.current_clinic_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient intake: PERSONAL_FIRST' USING ERRCODE = '55000';
  END IF;
  PERFORM app.log_event('patient_intake.medical_saved', 'SUCCESS', 'patients', v_patient::text, NULL, NULL, NULL, NULL);
END
$$;

-- Step 2 skipped ("I'll add this later"): marks the step seen; changes no answers.
CREATE FUNCTION app.skip_patient_intake_medical() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.intake_current_patient();
BEGIN
  UPDATE public.patient_intake_profiles
     SET "medicalReviewedAt" = coalesce("medicalReviewedAt", pg_catalog.now()), "updatedAt" = pg_catalog.now()
   WHERE "patientId" = v_patient AND "clinicId" = app.current_clinic_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient intake: PERSONAL_FIRST' USING ERRCODE = '55000';
  END IF;
END
$$;

-- Step 3. One NEW pre-visit questionnaire (never overwrites an earlier one).
CREATE FUNCTION app.submit_patient_symptom_report(
  p_request_id uuid, p_appointment_id uuid, p_reason text, p_symptoms text, p_onset text, p_severity text, p_notes text
) RETURNS TABLE (report_id uuid, appointment_id uuid, created boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.intake_current_patient();
  v_clinic uuid := app.current_clinic_id();
  v_reason text := pg_catalog.btrim(p_reason);
  v_symptoms text := pg_catalog.btrim(p_symptoms);
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
  v_id uuid;
BEGIN
  IF p_request_id IS NULL
     OR v_reason IS NULL OR pg_catalog.length(v_reason) NOT BETWEEN 1 AND 300
     OR v_symptoms IS NULL OR pg_catalog.length(v_symptoms) NOT BETWEEN 1 AND 2000
     OR p_onset IS NULL OR p_onset NOT IN ('TODAY', 'DAYS_1_3', 'DAYS_4_7', 'WEEKS_1_4', 'OVER_1_MONTH', 'UNSURE')
     OR (p_severity IS NOT NULL AND p_severity NOT IN ('MILD', 'MODERATE', 'SEVERE'))
     OR coalesce(pg_catalog.length(v_notes), 0) > 2000 THEN
    RAISE EXCEPTION 'patient intake: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- A repeated submission (same request id) returns the first report.
  SELECT r.id, r."appointmentId" INTO report_id, appointment_id
    FROM public.patient_symptom_reports r WHERE r."patientId" = v_patient AND r."requestId" = p_request_id;
  IF FOUND THEN
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- The appointment must be the caller's OWN upcoming appointment in this clinic.
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.appointments a
        WHERE a.id = p_appointment_id AND a."clinicId" = v_clinic AND a."patientId" = v_patient
          AND a.status IN ('SCHEDULED', 'CONFIRMED') AND a."startsAt" > pg_catalog.now() - interval '12 hours') THEN
    RAISE EXCEPTION 'patient intake: APPOINTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.patient_symptom_reports r
       WHERE r."patientId" = v_patient AND r."createdAt" > pg_catalog.now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'patient intake: RATE_LIMITED' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.patient_symptom_reports
    ("clinicId", "patientId", "appointmentId", "requestId", reason, symptoms, onset, severity, notes, "reportedByUserId")
  VALUES (v_clinic, v_patient, p_appointment_id, p_request_id, v_reason, v_symptoms, p_onset::public."SymptomOnset",
          p_severity::public."SymptomSeverity", v_notes, app.current_user_id())
  ON CONFLICT ("patientId", "requestId") DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN -- a concurrent duplicate won the race: return that one
    SELECT r.id, r."appointmentId" INTO report_id, appointment_id
      FROM public.patient_symptom_reports r WHERE r."patientId" = v_patient AND r."requestId" = p_request_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM app.log_event('patient_intake.symptoms_submitted', 'SUCCESS', 'patients', v_patient::text, NULL, NULL, NULL,
                        pg_catalog.jsonb_build_object('appointmentLinked', p_appointment_id IS NOT NULL));
  report_id := v_id;
  appointment_id := p_appointment_id;
  created := true;
  RETURN NEXT;
END
$$;

-- Completion: needs the saved personal step only (medical history and symptoms are optional).
CREATE FUNCTION app.complete_patient_intake() RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.intake_current_patient();
  v_before timestamptz;
  v_after timestamptz;
BEGIN
  SELECT "completedAt" INTO v_before FROM public.patient_intake_profiles
   WHERE "patientId" = v_patient AND "clinicId" = app.current_clinic_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient intake: PERSONAL_FIRST' USING ERRCODE = '55000';
  END IF;
  UPDATE public.patient_intake_profiles
     SET "completedAt" = coalesce("completedAt", pg_catalog.now()), "medicalReviewedAt" = coalesce("medicalReviewedAt", pg_catalog.now()),
         "updatedAt" = pg_catalog.now()
   WHERE "patientId" = v_patient AND "clinicId" = app.current_clinic_id()
  RETURNING "completedAt" INTO v_after;
  IF v_before IS NULL THEN
    PERFORM app.log_event('patient_intake.completed', 'SUCCESS', 'patients', v_patient::text, NULL, NULL, NULL, NULL);
  END IF;
  RETURN v_after;
END
$$;

REVOKE ALL ON FUNCTION app.save_patient_intake_personal(text, date, text, text, text, text, text, text, text, text, text),
  app.save_patient_intake_medical(text, jsonb, jsonb, text[], text, text), app.skip_patient_intake_medical(),
  app.submit_patient_symptom_report(uuid, uuid, text, text, text, text, text), app.complete_patient_intake() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_patient_intake_personal(text, date, text, text, text, text, text, text, text, text, text),
  app.save_patient_intake_medical(text, jsonb, jsonb, text[], text, text), app.skip_patient_intake_medical(),
  app.submit_patient_symptom_report(uuid, uuid, text, text, text, text, text), app.complete_patient_intake() TO sehat_app;

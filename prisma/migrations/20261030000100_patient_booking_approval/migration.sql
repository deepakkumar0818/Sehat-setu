-- Receptionist approval of patient self-booked appointments, step 2 of 2.
--
-- * A patient's booking (app.patient_book_appointment) is now PENDING_APPROVAL,
--   not SCHEDULED. It holds its slot (same advisory lock and busy checks as
--   before) but isn't on the doctor's schedule until reception approves it.
--   A patient rescheduling a request — or a confirmed visit — makes it
--   PENDING_APPROVAL again.
-- * Reception decides through two new SECURITY DEFINER functions:
--     app.approve_patient_booking(id)          PENDING_APPROVAL → CONFIRMED
--     app.reject_patient_booking(id, reason)   PENDING_APPROVAL → REJECTED
--   Both require a verified staff member holding appointment.update whose
--   branch scope covers the appointment, and record who decided and when.
--   Approval re-checks, under the slot lock: still pending, not started, doctor
--   ACTIVE at the ACTIVE branch, patient ACTIVE, no other active booking for the
--   doctor or the patient at that time.
-- * REJECTED frees the slot like CANCELLED/NO_SHOW (every busy check below).
-- * Guard trigger: the runtime role can't create, move, approve, reject or
--   revive a request any other way, nor write the review columns — even though
--   it holds table-wide UPDATE on appointments. The review functions run as
--   their owner and are the only path.
-- * Notifications: a new or moved request → BOOKING_REQUESTED to the branch's
--   appointment staff; the doctor hears about it only once it's approved.
--   Patients have no in-app notifications (staff only); they see the decision
--   and the reason in the portal.
-- * The patient symptom questionnaire may now be linked to a pending request.
-- Additive: new nullable columns, a CHECK, an index, a trigger; functions are
-- replaced in place (CREATE OR REPLACE keeps their grants). No data changes.

-- ---------------------------------------------------------------------------
-- Review columns
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN "approvedAt"       timestamptz(6),
  ADD COLUMN "approvedByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN "rejectedAt"       timestamptz(6),
  ADD COLUMN "rejectedByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN "rejectionReason"  text CHECK ("rejectionReason" IS NULL OR pg_catalog.length("rejectionReason") <= 300),
  ADD CONSTRAINT appointments_rejection_recorded CHECK (
    status <> 'REJECTED' OR ("rejectedAt" IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(coalesce("rejectionReason", ''))) >= 3)
  );

CREATE INDEX appointments_pending_review_idx ON appointments ("clinicId", "startsAt") WHERE status = 'PENDING_APPROVAL';

-- ---------------------------------------------------------------------------
-- Guard: requests and decisions change only through the definer functions
-- ---------------------------------------------------------------------------
-- Deliberately NOT security definer: current_user is 'sehat_app' for the
-- runtime role's own statements and the function owner inside the definer
-- functions (patient booking, approve, reject), which are allowed.
CREATE FUNCTION app.guard_appointment_review() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS
$$
DECLARE
  c_review constant text[] := ARRAY['PENDING_APPROVAL', 'REJECTED'];
BEGIN
  IF current_user::text <> 'sehat_app' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text = ANY (c_review) OR NEW."approvedAt" IS NOT NULL OR NEW."approvedByUserId" IS NOT NULL
       OR NEW."rejectedAt" IS NOT NULL OR NEW."rejectedByUserId" IS NOT NULL OR NEW."rejectionReason" IS NOT NULL THEN
      RAISE EXCEPTION 'appointment review: NOT_PERMITTED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status::text = ANY (c_review) OR NEW.status::text = ANY (c_review)
     OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
     OR NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt" OR NEW."rejectedByUserId" IS DISTINCT FROM OLD."rejectedByUserId"
     OR NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason" THEN
    RAISE EXCEPTION 'appointment review: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.guard_appointment_review() FROM PUBLIC;
CREATE TRIGGER guard_appointment_review BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.guard_appointment_review();

-- ---------------------------------------------------------------------------
-- Busy checks: REJECTED frees the slot (as CANCELLED and NO_SHOW do)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.doctor_busy_slots(p_doctor_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT a."startsAt"
  FROM public.appointments a
  JOIN public.doctor_profiles d ON d.id = a."doctorId"
  WHERE a."doctorId" = p_doctor_id
    AND d."clinicId" = app.current_clinic_id()
    AND app.is_staff_member()
    AND p_to > p_from
    AND p_to - p_from <= interval '31 days'
    AND a."startsAt" >= p_from AND a."startsAt" < p_to
    AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
$$;

CREATE OR REPLACE FUNCTION app.patient_doctor_busy_slots(p_doctor_id uuid, p_from timestamptz, p_to timestamptz)
  RETURNS SETOF timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT a."startsAt"
    FROM public.appointments a
    JOIN public.doctor_profiles d ON d.id = a."doctorId"
   WHERE a."doctorId" = p_doctor_id
     AND d."clinicId" = app.current_clinic_id()
     AND pg_catalog.cardinality(app.current_patient_ids()) > 0
     AND p_to > p_from
     AND p_to - p_from <= interval '31 days'
     AND a."startsAt" >= p_from AND a."startsAt" < p_to
     AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
$$;

CREATE OR REPLACE FUNCTION app.patient_check_new_slot(p_patient uuid, p_doctor_id uuid, p_at timestamptz, p_except uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF p_at IS NULL OR NOT app.is_standard_slot(p_at) THEN
    RAISE EXCEPTION 'patient booking: INVALID_SLOT' USING ERRCODE = '22023';
  END IF;
  IF p_at < pg_catalog.now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'patient booking: TOO_SOON' USING ERRCODE = '22023';
  END IF;
  IF p_at > pg_catalog.now() + interval '60 days' THEN
    RAISE EXCEPTION 'patient booking: TOO_FAR' USING ERRCODE = '22023';
  END IF;

  PERFORM app.lock_doctor_slot(p_doctor_id, p_at);
  -- Serialise this patient's own bookings too (duplicate/limit checks below).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:patient-booking:' || p_patient::text, 0));

  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."doctorId" = p_doctor_id AND a."startsAt" = p_at
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: SLOT_TAKEN' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."patientId" = p_patient AND a."startsAt" = p_at
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: PATIENT_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."patientId" = p_patient AND a."doctorId" = p_doctor_id
                AND (a."startsAt" AT TIME ZONE 'Asia/Kolkata')::date = (p_at AT TIME ZONE 'Asia/Kolkata')::date
                AND a.status::text = ANY (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: DUPLICATE' USING ERRCODE = '23505';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Patient booking: requests are PENDING_APPROVAL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.patient_book_appointment(p_doctor_id uuid, p_branch_id uuid, p_starts_at timestamptz, p_reason text, p_type text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_clinic  uuid := app.current_clinic_id();
  v_reason  text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_reason, '')), '\s+', ' ', 'g');
  v_type    text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_type, '')));
  v_id      uuid;
BEGIN
  IF pg_catalog.length(v_reason) NOT BETWEEN 2 AND 300 OR v_type NOT IN ('IN_PERSON', 'ONLINE') THEN
    RAISE EXCEPTION 'patient booking: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.doctor_profiles d
                   JOIN public.doctor_branches db ON db."doctorId" = d.id AND db."clinicId" = d."clinicId"
                   JOIN public.branches b ON b.id = db."branchId" AND b."clinicId" = d."clinicId"
                  WHERE d.id = p_doctor_id AND d."clinicId" = v_clinic AND d.status = 'ACTIVE'
                    AND b.id = p_branch_id AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'patient booking: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM public.doctor_profiles d WHERE d.id = p_doctor_id AND d."onlineConsultation") THEN
    RAISE EXCEPTION 'patient booking: ONLINE_UNAVAILABLE' USING ERRCODE = '22023';
  END IF;

  PERFORM app.patient_check_new_slot(v_patient, p_doctor_id, p_starts_at, NULL);
  -- Pending requests count towards the limit too.
  IF (SELECT pg_catalog.count(*) FROM public.appointments a
       WHERE a."patientId" = v_patient AND a.status::text = ANY (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED'])
         AND a."startsAt" > pg_catalog.now()) >= 5 THEN
    RAISE EXCEPTION 'patient booking: LIMIT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.appointments (id, "clinicId", "branchId", "patientId", "doctorId", "startsAt", "durationMinutes", type, status, reason, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_patient, p_doctor_id, p_starts_at, 30, v_type::public."AppointmentType", 'PENDING_APPROVAL', v_reason, pg_catalog.now())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- A patient may withdraw a pending request, or cancel a confirmed visit, before it starts.
CREATE OR REPLACE FUNCTION app.patient_cancel_appointment(p_appointment_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_appt    public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_appt FROM public.appointments a
   WHERE a.id = p_appointment_id AND a."patientId" = v_patient AND a."clinicId" = app.current_clinic_id() FOR UPDATE;
  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'patient booking: NOT_FOUND' USING ERRCODE = '22023'; -- someone else's looks the same as none
  END IF;
  IF v_appt.status::text <> ALL (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED']) OR v_appt."startsAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
  UPDATE public.appointments SET status = 'CANCELLED', "cancelledAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = v_appt.status;
END
$$;

-- Moving a request or a confirmed visit makes it a request again (reception re-approves the new time).
CREATE OR REPLACE FUNCTION app.patient_reschedule_appointment(p_appointment_id uuid, p_starts_at timestamptz) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_appt    public.appointments%ROWTYPE;
BEGIN
  -- No row lock yet: the slot lock below comes first, in the same order as the
  -- staff reschedule path (slot lock, then row update), so the two can't deadlock.
  SELECT * INTO v_appt FROM public.appointments a
   WHERE a.id = p_appointment_id AND a."patientId" = v_patient AND a."clinicId" = app.current_clinic_id();
  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'patient booking: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_appt.status::text <> ALL (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED']) OR v_appt."startsAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
  IF p_starts_at = v_appt."startsAt" THEN
    RETURN;
  END IF;
  -- Same doctor and branch, which must still be bookable.
  IF NOT EXISTS (SELECT 1 FROM public.doctor_profiles d
                   JOIN public.doctor_branches db ON db."doctorId" = d.id AND db."branchId" = v_appt."branchId"
                   JOIN public.branches b ON b.id = db."branchId"
                  WHERE d.id = v_appt."doctorId" AND d.status = 'ACTIVE' AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
  PERFORM app.patient_check_new_slot(v_patient, v_appt."doctorId", p_starts_at, v_appt.id);
  -- Only if nobody changed it meanwhile (status and time as read above).
  UPDATE public.appointments
     SET "startsAt" = p_starts_at, status = 'PENDING_APPROVAL', "approvedAt" = NULL, "approvedByUserId" = NULL, "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = v_appt.status AND "startsAt" = v_appt."startsAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Reception: approve / reject
-- ---------------------------------------------------------------------------
-- The pending request in the caller's clinic and branch scope, or a refusal.
CREATE FUNCTION app.review_target(p_appointment_id uuid) RETURNS public.appointments
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_appt public.appointments%ROWTYPE;
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL OR NOT app.is_staff_member()
     OR NOT app.staff_can(ARRAY['appointment.update']) THEN
    RAISE EXCEPTION 'booking review: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_appt FROM public.appointments a
   WHERE a.id = p_appointment_id AND a."clinicId" = app.current_clinic_id() AND app.branch_visible(a."branchId");
  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'booking review: NOT_FOUND' USING ERRCODE = '22023'; -- another clinic's or branch's looks the same as none
  END IF;
  IF v_appt.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'booking review: NOT_PENDING' USING ERRCODE = '22023';
  END IF;
  RETURN v_appt;
END
$$;
REVOKE ALL ON FUNCTION app.review_target(uuid) FROM PUBLIC;

CREATE FUNCTION app.approve_patient_booking(p_appointment_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_appt public.appointments%ROWTYPE := app.review_target(p_appointment_id);
BEGIN
  IF v_appt."startsAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'booking review: EXPIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.doctor_profiles d
                   JOIN public.doctor_branches db ON db."doctorId" = d.id AND db."clinicId" = d."clinicId" AND db."branchId" = v_appt."branchId"
                   JOIN public.branches b ON b.id = db."branchId" AND b."clinicId" = d."clinicId"
                  WHERE d.id = v_appt."doctorId" AND d."clinicId" = v_appt."clinicId" AND d.status = 'ACTIVE' AND b.status = 'ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_appt."patientId" AND p."clinicId" = v_appt."clinicId" AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'booking review: UNAVAILABLE' USING ERRCODE = '22023';
  END IF;

  -- The same slot lock as every booking path, then the slot re-checked under it.
  PERFORM app.lock_doctor_slot(v_appt."doctorId", v_appt."startsAt");
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."doctorId" = v_appt."doctorId" AND a."startsAt" = v_appt."startsAt" AND a.id <> v_appt.id
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])) THEN
    RAISE EXCEPTION 'booking review: SLOT_TAKEN' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."patientId" = v_appt."patientId" AND a."startsAt" = v_appt."startsAt" AND a.id <> v_appt.id
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])) THEN
    RAISE EXCEPTION 'booking review: PATIENT_CONFLICT' USING ERRCODE = '23505';
  END IF;

  -- Only if nobody decided, moved or withdrew it meanwhile.
  UPDATE public.appointments
     SET status = 'CONFIRMED', "approvedAt" = pg_catalog.now(), "approvedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = 'PENDING_APPROVAL' AND "startsAt" = v_appt."startsAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking review: NOT_PENDING' USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE FUNCTION app.reject_patient_booking(p_appointment_id uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_reason text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_reason, '')), '\s+', ' ', 'g');
  v_appt   public.appointments%ROWTYPE;
BEGIN
  IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'booking review: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  v_appt := app.review_target(p_appointment_id);
  UPDATE public.appointments
     SET status = 'REJECTED', "rejectedAt" = pg_catalog.now(), "rejectedByUserId" = app.current_user_id(),
         "rejectionReason" = v_reason, "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = 'PENDING_APPROVAL';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking review: NOT_PENDING' USING ERRCODE = '22023';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.approve_patient_booking(uuid), app.reject_patient_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approve_patient_booking(uuid), app.reject_patient_booking(uuid, text) TO sehat_app;

-- ---------------------------------------------------------------------------
-- Pre-visit symptom questionnaire: may be linked to a pending request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.submit_patient_symptom_report(
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

  -- The appointment must be the caller's OWN upcoming appointment (or pending request) in this clinic.
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.appointments a
        WHERE a.id = p_appointment_id AND a."clinicId" = v_clinic AND a."patientId" = v_patient
          AND a.status IN ('PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED') AND a."startsAt" > pg_catalog.now() - interval '12 hours') THEN
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

-- ---------------------------------------------------------------------------
-- Notifications: requests go to reception; the doctor hears once approved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.notify_appointment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c_closed constant text[] := ARRAY['CANCELLED', 'NO_SHOW', 'COMPLETED', 'REJECTED'];
  c_review constant text[] := ARRAY['appointment.update'];
  v_doctor uuid;
  v_old_doctor uuid;
  v_data jsonb := pg_catalog.jsonb_build_object('startsAt', NEW."startsAt", 'branchId', NEW."branchId");
  v_new_pending boolean := NEW.status = 'PENDING_APPROVAL';
  v_old_pending boolean := false;
  -- "On the doctor's schedule": neither closed nor awaiting approval.
  v_new_listed boolean := NOT (NEW.status::text = ANY (c_closed)) AND NEW.status <> 'PENDING_APPROVAL';
  v_old_listed boolean := false;
BEGIN
  SELECT d."userId" INTO v_doctor FROM public.doctor_profiles d WHERE d.id = NEW."doctorId" AND d."clinicId" = NEW."clinicId";

  IF TG_OP = 'INSERT' THEN
    IF v_new_pending THEN
      PERFORM app.add_notification(NEW."clinicId", 'BRANCH', NULL, NEW."branchId", c_review, 'BOOKING_REQUESTED', NEW.id, v_data);
    ELSIF v_new_listed THEN
      PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_BOOKED', NEW.id, v_data);
    END IF;
    RETURN NULL;
  END IF;

  v_old_pending := OLD.status = 'PENDING_APPROVAL';
  v_old_listed := NOT (OLD.status::text = ANY (c_closed)) AND OLD.status <> 'PENDING_APPROVAL';

  IF NEW."doctorId" IS DISTINCT FROM OLD."doctorId" THEN
    IF v_old_listed THEN
      SELECT d."userId" INTO v_old_doctor FROM public.doctor_profiles d WHERE d.id = OLD."doctorId" AND d."clinicId" = OLD."clinicId";
      PERFORM app.add_notification(OLD."clinicId", 'PERSONAL', v_old_doctor, NULL, NULL, 'APPOINTMENT_CANCELLED', OLD.id,
        pg_catalog.jsonb_build_object('startsAt', OLD."startsAt", 'branchId', OLD."branchId", 'reason', 'reassigned'));
    END IF;
    IF v_new_listed THEN
      PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_BOOKED', NEW.id, v_data);
    END IF;
  ELSIF v_new_pending AND (NOT v_old_pending OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt") THEN
    -- A new or moved request for reception. A confirmed visit the patient moved leaves the doctor's schedule until re-approved.
    IF v_old_listed THEN
      PERFORM app.add_notification(OLD."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_CANCELLED', OLD.id,
        pg_catalog.jsonb_build_object('startsAt', OLD."startsAt", 'branchId', OLD."branchId", 'reason', 'awaiting_approval'));
    END IF;
    PERFORM app.add_notification(NEW."clinicId", 'BRANCH', NULL, NEW."branchId", c_review, 'BOOKING_REQUESTED', NEW.id, v_data);
  ELSIF v_old_pending THEN
    -- Approved: now on the doctor's schedule. Rejected or withdrawn: the doctor never had it.
    IF v_new_listed THEN
      PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_BOOKED', NEW.id, v_data);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CANCELLED' THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_CANCELLED', NEW.id,
      v_data || pg_catalog.jsonb_build_object('reason', 'cancelled'));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CHECKED_IN' THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_CHECKED_IN', NEW.id, v_data);
  ELSIF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" AND v_new_listed THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_RESCHEDULED', NEW.id,
      v_data || pg_catalog.jsonb_build_object('previousStartsAt', OLD."startsAt"));
  END IF;
  RETURN NULL;
END
$$;

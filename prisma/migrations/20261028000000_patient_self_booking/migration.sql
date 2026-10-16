-- Patient portal self-booking: a signed-in patient books, cancels and
-- reschedules THEIR OWN appointments in the existing public.appointments table.
--
-- * Who: a session pinned to a PATIENT membership (app.current_patient_ids()
--   non-empty: verified login, ACTIVE PATIENT membership, record linked by the
--   clinic's single-use code or self-registration). Exactly one ACTIVE record
--   in the pinned clinic, or a refusal. The patient id never comes from the
--   browser; staff use the existing staff paths and RLS policies unchanged.
-- * Why functions: RLS gives patients SELECT on their own appointments only
--   (appointments_read); appointments_insert/update require staff permissions,
--   and stay that way. These SECURITY DEFINER functions are the only patient
--   write path and re-check everything.
-- * Scheduling rules = the staff ones (src/server/data/appointments.ts):
--     - slots: the clinic's standard hours (src/server/data/mappers.ts
--       defaultSlotsFor): Mon–Sat, 09:00–17:00 IST, every 30 minutes, no
--       13:00–14:00 lunch slot, no Sundays;
--     - one active booking per doctor per start time (CANCELLED/NO_SHOW free
--       the slot), serialised with the SAME advisory lock key the staff path
--       uses ('slot:<doctorId>:<ISO instant>'), so a patient and a receptionist
--       can't take the same slot concurrently;
--     - the doctor must be ACTIVE and practise at the chosen ACTIVE branch.
-- * Visit type: IN_PERSON, or ONLINE only with a doctor whose profile offers
--   online consultation (doctor_profiles."onlineConsultation"). Same slots,
--   same lock: a doctor can't be in an online and an in-person visit at once.
-- * Patient-only limits: at least 30 minutes ahead and at most 60 days ahead;
--   no two of the patient's own active appointments at the same time; one per
--   doctor per day; at most 5 upcoming self-managed (SCHEDULED/CONFIRMED)
--   appointments. Cancel/reschedule only SCHEDULED/CONFIRMED appointments that
--   haven't started — the same "not started yet" rule staff follow.
-- * Every change is row-audited by the existing audit_appointments trigger
--   (actor = the pinned patient user) and notified by notify_appointments.
--
-- Refusals: 'patient booking: <CODE>' with CODE in NOT_PERMITTED, NOT_FOUND,
-- INVALID_INPUT, INVALID_SLOT, TOO_SOON, TOO_FAR, SLOT_TAKEN, PATIENT_CONFLICT,
-- DUPLICATE, LIMIT, NOT_CHANGEABLE, ONLINE_UNAVAILABLE.

-- The caller's ONE linked, ACTIVE patient record in the pinned clinic.
CREATE FUNCTION app.booking_current_patient() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_ids uuid[] := app.current_patient_ids();
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL OR pg_catalog.cardinality(v_ids) <> 1 THEN
    RAISE EXCEPTION 'patient booking: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_ids[1] AND p."clinicId" = app.current_clinic_id() AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'patient booking: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  RETURN v_ids[1];
END
$$;
REVOKE ALL ON FUNCTION app.booking_current_patient() FROM PUBLIC;

-- True when p_at is one of the clinic's standard slots (mirrors defaultSlotsFor).
CREATE FUNCTION app.is_standard_slot(p_at timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS
$$
  SELECT pg_catalog.date_part('isodow', l) <> 7
     AND pg_catalog.date_part('second', l) = 0
     AND (pg_catalog.date_part('hour', l) * 60 + pg_catalog.date_part('minute', l))::int % 30 = 0
     AND (pg_catalog.date_part('hour', l) * 60 + pg_catalog.date_part('minute', l))::int BETWEEN 540 AND 990
     AND NOT (pg_catalog.date_part('hour', l) = 13)
    FROM (SELECT p_at AT TIME ZONE 'Asia/Kolkata' AS l) s
$$;
REVOKE ALL ON FUNCTION app.is_standard_slot(timestamptz) FROM PUBLIC;

-- The staff path's slot lock key (src/server/data/appointments.ts lockSlot):
-- hashtext('slot:' || doctorId || ':' || startsAt.toISOString()).
CREATE FUNCTION app.lock_doctor_slot(p_doctor_id uuid, p_at timestamptz) RETURNS void
  LANGUAGE sql VOLATILE SET search_path = '' AS
$$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'slot:' || p_doctor_id::text || ':' || pg_catalog.to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;
REVOKE ALL ON FUNCTION app.lock_doctor_slot(uuid, timestamptz) FROM PUBLIC;

-- Busy start times of a doctor of the patient's own clinic (times only, never
-- who): the patient counterpart of app.doctor_busy_slots (staff only).
CREATE FUNCTION app.patient_doctor_busy_slots(p_doctor_id uuid, p_from timestamptz, p_to timestamptz)
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
     AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW'])
$$;
REVOKE ALL ON FUNCTION app.patient_doctor_busy_slots(uuid, timestamptz, timestamptz) FROM PUBLIC;

-- Shared checks for a NEW start time of the caller's appointment (book or move).
CREATE FUNCTION app.patient_check_new_slot(p_patient uuid, p_doctor_id uuid, p_at timestamptz, p_except uuid) RETURNS void
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
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: SLOT_TAKEN' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."patientId" = p_patient AND a."startsAt" = p_at
                AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: PATIENT_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
              WHERE a."patientId" = p_patient AND a."doctorId" = p_doctor_id
                AND (a."startsAt" AT TIME ZONE 'Asia/Kolkata')::date = (p_at AT TIME ZONE 'Asia/Kolkata')::date
                AND a.status::text = ANY (ARRAY['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION'])
                AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'patient booking: DUPLICATE' USING ERRCODE = '23505';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.patient_check_new_slot(uuid, uuid, timestamptz, uuid) FROM PUBLIC;

CREATE FUNCTION app.patient_book_appointment(p_doctor_id uuid, p_branch_id uuid, p_starts_at timestamptz, p_reason text, p_type text)
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
  IF (SELECT pg_catalog.count(*) FROM public.appointments a
       WHERE a."patientId" = v_patient AND a.status::text = ANY (ARRAY['SCHEDULED', 'CONFIRMED'])
         AND a."startsAt" > pg_catalog.now()) >= 5 THEN
    RAISE EXCEPTION 'patient booking: LIMIT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.appointments (id, "clinicId", "branchId", "patientId", "doctorId", "startsAt", "durationMinutes", type, status, reason, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_patient, p_doctor_id, p_starts_at, 30, v_type::public."AppointmentType", 'SCHEDULED', v_reason, pg_catalog.now())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION app.patient_cancel_appointment(p_appointment_id uuid) RETURNS void
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
  IF v_appt.status::text <> ALL (ARRAY['SCHEDULED', 'CONFIRMED']) OR v_appt."startsAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
  UPDATE public.appointments SET status = 'CANCELLED', "cancelledAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = v_appt.status;
END
$$;

CREATE FUNCTION app.patient_reschedule_appointment(p_appointment_id uuid, p_starts_at timestamptz) RETURNS void
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
  IF v_appt.status::text <> ALL (ARRAY['SCHEDULED', 'CONFIRMED']) OR v_appt."startsAt" <= pg_catalog.now() THEN
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
  UPDATE public.appointments SET "startsAt" = p_starts_at, status = 'SCHEDULED', "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = v_appt.status AND "startsAt" = v_appt."startsAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.patient_book_appointment(uuid, uuid, timestamptz, text, text), app.patient_cancel_appointment(uuid),
  app.patient_reschedule_appointment(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.patient_doctor_busy_slots(uuid, timestamptz, timestamptz), app.patient_book_appointment(uuid, uuid, timestamptz, text, text),
  app.patient_cancel_appointment(uuid), app.patient_reschedule_appointment(uuid, timestamptz) TO sehat_app;

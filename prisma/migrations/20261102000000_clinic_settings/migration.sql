-- Clinic settings: one row per clinic, edited by its administrators on the
-- Settings page, and enforced here (not only in the browser):
-- * Clinic timings: opening hours per weekday (closed days), one daily break,
--   and the appointment slot length. Patient bookings must fall on a slot that
--   fits inside the day's hours and outside the break. Staff may still book
--   any time (walk-ins, extra hours), as before.
-- * Double-booking is now checked by OVERLAP (an appointment occupies
--   [startsAt, startsAt + durationMinutes)), not by equal start times, so slot
--   lengths can differ between bookings made before and after a change. Every
--   booking path takes one lock per doctor per IST day (in addition to the
--   existing per-start-time lock), so overlapping bookings are serialised.
-- * Online booking rules: booking on/off (cancelling stays possible), approval
--   by reception or instant confirmation, minimum notice, how far ahead, the
--   most upcoming bookings per patient, and whether patients may pay online.
-- * Billing: invoice number prefix, GSTIN, the default tax % offered on new
--   bills, a footer printed on bills, and the payment methods reception records.
-- * Branding: logo (a small PNG/JPEG/WebP image stored inline), website and
--   the clinic's registration number, printed on bills and prescriptions.
-- Defaults reproduce the rules built in until now (Mon–Sat 09:00–17:00, break
-- 13:00–14:00, 30-minute slots, approval required, 30 minutes to 60 days
-- ahead, 5 upcoming), so nothing changes until an administrator edits them.
-- Every clinic gets its row now and on creation; rows are never inserted or
-- deleted by the app. Changes need clinic.settings.manage and a clinic-wide
-- membership, and are audited (which columns, not values).
-- Functions are replaced in place (CREATE OR REPLACE keeps their grants); the
-- old start-time functions stay for the app version deployed before this one.
-- Refusals added: 'patient booking: CLOSED'.

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------
-- 'HH:MM' (00:00–23:59) → minutes after midnight; NULL when malformed.
CREATE FUNCTION app.hhmm_minutes(p text) RETURNS integer
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$
  SELECT CASE WHEN p ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              THEN pg_catalog.substr(p, 1, 2)::integer * 60 + pg_catalog.substr(p, 4, 2)::integer END
$$;

-- {"mon": {"open": "09:00", "close": "17:00"}, ..., "sun": null}: all seven
-- days, each closed (null) or open on 5-minute boundaries with open < close.
CREATE FUNCTION app.valid_weekly_hours(p jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$
  SELECT pg_catalog.jsonb_typeof(p) = 'object'
     AND (SELECT pg_catalog.array_agg(k ORDER BY k COLLATE "C") FROM pg_catalog.jsonb_object_keys(p) k)
         = ARRAY['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed']
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_each(p) e(k, v)
        WHERE pg_catalog.jsonb_typeof(v) <> 'null'
          AND NOT coalesce(
                pg_catalog.jsonb_typeof(v) = 'object'
            AND (SELECT pg_catalog.array_agg(x ORDER BY x COLLATE "C") FROM pg_catalog.jsonb_object_keys(v) x) = ARRAY['close', 'open']
            AND app.hhmm_minutes(v ->> 'open') % 5 = 0
            AND app.hhmm_minutes(v ->> 'close') % 5 = 0
            AND app.hhmm_minutes(v ->> 'open') < app.hhmm_minutes(v ->> 'close'), false))
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE "clinic_settings" (
  "id"       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId" uuid NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE RESTRICT,

  -- Clinic timings (IST)
  "weeklyHours" jsonb NOT NULL DEFAULT '{"mon": {"open": "09:00", "close": "17:00"}, "tue": {"open": "09:00", "close": "17:00"},
    "wed": {"open": "09:00", "close": "17:00"}, "thu": {"open": "09:00", "close": "17:00"}, "fri": {"open": "09:00", "close": "17:00"},
    "sat": {"open": "09:00", "close": "17:00"}, "sun": null}'
    CHECK (app.valid_weekly_hours("weeklyHours")),
  "breakStart"  text DEFAULT '13:00',
  "breakEnd"    text DEFAULT '14:00',
  "slotMinutes" integer NOT NULL DEFAULT 30 CHECK ("slotMinutes" IN (10, 15, 20, 30, 45, 60)),

  -- Online booking (patient portal)
  "onlineBookingEnabled"    boolean NOT NULL DEFAULT true,
  "bookingNeedsApproval"    boolean NOT NULL DEFAULT true,
  "bookingMinNoticeMinutes" integer NOT NULL DEFAULT 30 CHECK ("bookingMinNoticeMinutes" BETWEEN 0 AND 2880),
  "bookingMaxDaysAhead"     integer NOT NULL DEFAULT 60 CHECK ("bookingMaxDaysAhead" BETWEEN 1 AND 180),
  "bookingMaxUpcoming"      integer NOT NULL DEFAULT 5 CHECK ("bookingMaxUpcoming" BETWEEN 1 AND 20),
  "patientOnlinePayments"   boolean NOT NULL DEFAULT true,

  -- Billing
  "invoicePrefix"     text CHECK ("invoicePrefix" ~ '^[A-Z0-9][A-Z0-9/-]{0,11}$'),
  "gstin"             text CHECK ("gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  "defaultTaxPercent" integer NOT NULL DEFAULT 0 CHECK ("defaultTaxPercent" BETWEEN 0 AND 28),
  "invoiceFooter"     text CHECK ("invoiceFooter" = pg_catalog.btrim("invoiceFooter") AND pg_catalog.length("invoiceFooter") BETWEEN 1 AND 500),
  "paymentMethods"    text[] NOT NULL DEFAULT ARRAY['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE']
    CHECK (pg_catalog.cardinality("paymentMethods") >= 1 AND "paymentMethods" <@ ARRAY['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE']),

  -- Branding
  "logoDataUrl"        text CHECK (pg_catalog.length("logoDataUrl") <= 300000 AND "logoDataUrl" ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'),
  "website"            text CHECK (pg_catalog.length("website") <= 200 AND "website" ~ '^https?://[^\s/]+\.[^\s]+$'),
  "registrationNumber" text CHECK ("registrationNumber" = pg_catalog.btrim("registrationNumber") AND pg_catalog.length("registrationNumber") BETWEEN 1 AND 60),

  "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT clinic_settings_break CHECK (
    ("breakStart" IS NULL AND "breakEnd" IS NULL)
    OR coalesce(app.hhmm_minutes("breakStart") % 5 = 0 AND app.hhmm_minutes("breakEnd") % 5 = 0
                AND app.hhmm_minutes("breakStart") < app.hhmm_minutes("breakEnd"), false)
  )
);

-- ---------------------------------------------------------------------------
-- Privileges: read by the clinic's members; only settings columns are writable
-- ---------------------------------------------------------------------------
REVOKE ALL ON clinic_settings FROM anon, authenticated;
GRANT SELECT ON clinic_settings TO sehat_app;
GRANT UPDATE ("weeklyHours", "breakStart", "breakEnd", "slotMinutes",
              "onlineBookingEnabled", "bookingNeedsApproval", "bookingMinNoticeMinutes", "bookingMaxDaysAhead", "bookingMaxUpcoming", "patientOnlinePayments",
              "invoicePrefix", "gstin", "defaultTaxPercent", "invoiceFooter", "paymentMethods",
              "logoDataUrl", "website", "registrationNumber", "updatedAt") ON clinic_settings TO sehat_app;

ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;

-- Staff and patients of the clinic (patients see the booking rules and branding).
CREATE POLICY clinic_settings_read ON clinic_settings FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member())
);
CREATE POLICY clinic_settings_update ON clinic_settings FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id())
         AND (SELECT app.current_branch_id()) IS NULL
         AND (SELECT app.staff_can(ARRAY['clinic.settings.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE TRIGGER audit_clinic_settings AFTER INSERT OR UPDATE OR DELETE ON clinic_settings FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Every clinic has its row: existing clinics now, new ones on creation.
CREATE FUNCTION app.seed_new_clinic_settings() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  INSERT INTO public.clinic_settings ("clinicId") VALUES (NEW.id) ON CONFLICT ("clinicId") DO NOTHING;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.seed_new_clinic_settings() FROM PUBLIC;
CREATE TRIGGER seed_clinic_settings AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION app.seed_new_clinic_settings();

INSERT INTO clinic_settings ("clinicId") SELECT id FROM clinics ON CONFLICT ("clinicId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Slots and busy time
-- ---------------------------------------------------------------------------
-- True when p_at starts one of the clinic's slots: an open day, on the slot
-- grid counted from opening time, ending by closing time, clear of the break.
CREATE FUNCTION app.is_clinic_slot(p_clinic uuid, p_at timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS
$$
  SELECT coalesce((
    SELECT pg_catalog.date_part('second', l.t) = 0
       AND x.m >= x.o AND x.m + s."slotMinutes" <= x.c AND (x.m - x.o) % s."slotMinutes" = 0
       AND NOT (s."breakStart" IS NOT NULL
                AND x.m < app.hhmm_minutes(s."breakEnd") AND x.m + s."slotMinutes" > app.hhmm_minutes(s."breakStart"))
      FROM public.clinic_settings s
     CROSS JOIN LATERAL (SELECT p_at AT TIME ZONE 'Asia/Kolkata' AS t) l
     CROSS JOIN LATERAL (SELECT s."weeklyHours" -> (ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[pg_catalog.date_part('isodow', l.t)::integer] AS h) d
     CROSS JOIN LATERAL (SELECT app.hhmm_minutes(d.h ->> 'open') AS o, app.hhmm_minutes(d.h ->> 'close') AS c,
                                (pg_catalog.date_part('hour', l.t) * 60 + pg_catalog.date_part('minute', l.t))::integer AS m) x
     WHERE s."clinicId" = p_clinic), false)
$$;
REVOKE ALL ON FUNCTION app.is_clinic_slot(uuid, timestamptz) FROM PUBLIC;

-- The per-start-time lock as before, then one per doctor per IST day, so two
-- bookings that overlap without sharing a start time are serialised too. The
-- staff path calls this (granted below) instead of building the key itself.
CREATE OR REPLACE FUNCTION app.lock_doctor_slot(p_doctor_id uuid, p_at timestamptz) RETURNS void
  LANGUAGE sql VOLATILE SET search_path = '' AS
$$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'slot:' || p_doctor_id::text || ':' || pg_catalog.to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'slot-day:' || p_doctor_id::text || ':' || pg_catalog.to_char(p_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')));
$$;
GRANT EXECUTE ON FUNCTION app.lock_doctor_slot(uuid, timestamptz) TO sehat_app;

-- Active bookings of a doctor overlapping [p_from, p_to). No patient details.
-- (Appointments are shorter than a day: the lower bound keeps the index usable.)
CREATE FUNCTION app.doctor_bookings_overlapping(p_doctor_id uuid, p_from timestamptz, p_to timestamptz, p_except uuid)
  RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT a."startsAt", a."startsAt" + pg_catalog.make_interval(mins => a."durationMinutes")
    FROM public.appointments a
   WHERE a."doctorId" = p_doctor_id
     AND a."startsAt" < p_to AND a."startsAt" > p_from - interval '1 day'
     AND a."startsAt" + pg_catalog.make_interval(mins => a."durationMinutes") > p_from
     AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
     AND a.id IS DISTINCT FROM p_except
$$;
REVOKE ALL ON FUNCTION app.doctor_bookings_overlapping(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;

CREATE FUNCTION app.patient_bookings_overlapping(p_patient uuid, p_from timestamptz, p_to timestamptz, p_except uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.appointments a
     WHERE a."patientId" = p_patient
       AND a."startsAt" < p_to AND a."startsAt" > p_from - interval '1 day'
       AND a."startsAt" + pg_catalog.make_interval(mins => a."durationMinutes") > p_from
       AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW', 'REJECTED'])
       AND a.id IS DISTINCT FROM p_except)
$$;
REVOKE ALL ON FUNCTION app.patient_bookings_overlapping(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;

-- Staff: busy time of a doctor of the caller's own clinic, across every branch
-- (the overlap counterpart of app.doctor_busy_slots). p_except: the appointment
-- being moved, so it doesn't block itself.
CREATE FUNCTION app.doctor_busy_ranges(p_doctor_id uuid, p_from timestamptz, p_to timestamptz, p_except uuid DEFAULT NULL)
  RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT b.starts_at, b.ends_at
    FROM app.doctor_bookings_overlapping(p_doctor_id, p_from, p_to, p_except) b
   WHERE EXISTS (SELECT 1 FROM public.doctor_profiles d WHERE d.id = p_doctor_id AND d."clinicId" = app.current_clinic_id())
     AND app.is_staff_member()
     AND p_to > p_from AND p_to - p_from <= interval '31 days'
$$;
REVOKE ALL ON FUNCTION app.doctor_busy_ranges(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.doctor_busy_ranges(uuid, timestamptz, timestamptz, uuid) TO sehat_app;

-- Patients: the same for a doctor of their own clinic (times only).
CREATE FUNCTION app.patient_doctor_busy_ranges(p_doctor_id uuid, p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT b.starts_at, b.ends_at
    FROM app.doctor_bookings_overlapping(p_doctor_id, p_from, p_to, NULL) b
   WHERE EXISTS (SELECT 1 FROM public.doctor_profiles d WHERE d.id = p_doctor_id AND d."clinicId" = app.current_clinic_id())
     AND pg_catalog.cardinality(app.current_patient_ids()) > 0
     AND p_to > p_from AND p_to - p_from <= interval '31 days'
$$;
REVOKE ALL ON FUNCTION app.patient_doctor_busy_ranges(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.patient_doctor_busy_ranges(uuid, timestamptz, timestamptz) TO sehat_app;

-- ---------------------------------------------------------------------------
-- Patient booking: the clinic's settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.patient_check_new_slot(p_patient uuid, p_doctor_id uuid, p_at timestamptz, p_except uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  s public.clinic_settings%ROWTYPE;
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.clinic_settings c WHERE c."clinicId" = app.current_clinic_id();
  IF NOT FOUND OR NOT s."onlineBookingEnabled" THEN
    RAISE EXCEPTION 'patient booking: CLOSED' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL OR NOT app.is_clinic_slot(s."clinicId", p_at) THEN
    RAISE EXCEPTION 'patient booking: INVALID_SLOT' USING ERRCODE = '22023';
  END IF;
  IF p_at < pg_catalog.now() + pg_catalog.make_interval(mins => s."bookingMinNoticeMinutes") THEN
    RAISE EXCEPTION 'patient booking: TOO_SOON' USING ERRCODE = '22023';
  END IF;
  IF p_at > pg_catalog.now() + pg_catalog.make_interval(days => s."bookingMaxDaysAhead") THEN
    RAISE EXCEPTION 'patient booking: TOO_FAR' USING ERRCODE = '22023';
  END IF;
  v_end := p_at + pg_catalog.make_interval(mins => s."slotMinutes");

  PERFORM app.lock_doctor_slot(p_doctor_id, p_at);
  -- Serialise this patient's own bookings too (duplicate/limit checks below).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:patient-booking:' || p_patient::text, 0));

  IF EXISTS (SELECT 1 FROM app.doctor_bookings_overlapping(p_doctor_id, p_at, v_end, p_except)) THEN
    RAISE EXCEPTION 'patient booking: SLOT_TAKEN' USING ERRCODE = '23505';
  END IF;
  IF app.patient_bookings_overlapping(p_patient, p_at, v_end, p_except) THEN
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

CREATE OR REPLACE FUNCTION app.patient_book_appointment(p_doctor_id uuid, p_branch_id uuid, p_starts_at timestamptz, p_reason text, p_type text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_clinic  uuid := app.current_clinic_id();
  v_reason  text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_reason, '')), '\s+', ' ', 'g');
  v_type    text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_type, '')));
  s         public.clinic_settings%ROWTYPE;
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
  SELECT * INTO s FROM public.clinic_settings c WHERE c."clinicId" = v_clinic;
  -- Pending requests count towards the limit too.
  IF (SELECT pg_catalog.count(*) FROM public.appointments a
       WHERE a."patientId" = v_patient AND a.status::text = ANY (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED'])
         AND a."startsAt" > pg_catalog.now()) >= s."bookingMaxUpcoming" THEN
    RAISE EXCEPTION 'patient booking: LIMIT' USING ERRCODE = '22023';
  END IF;

  -- A request for reception to approve, or confirmed at once when the clinic doesn't review bookings.
  INSERT INTO public.appointments (id, "clinicId", "branchId", "patientId", "doctorId", "startsAt", "durationMinutes", type, status, reason, "approvedAt", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_patient, p_doctor_id, p_starts_at, s."slotMinutes", v_type::public."AppointmentType",
          CASE WHEN s."bookingNeedsApproval" THEN 'PENDING_APPROVAL' ELSE 'CONFIRMED' END::public."AppointmentStatus",
          v_reason, CASE WHEN s."bookingNeedsApproval" THEN NULL ELSE pg_catalog.now() END, pg_catalog.now())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Moving a request or a confirmed visit: a request again when the clinic reviews bookings, else confirmed.
CREATE OR REPLACE FUNCTION app.patient_reschedule_appointment(p_appointment_id uuid, p_starts_at timestamptz) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_appt    public.appointments%ROWTYPE;
  s         public.clinic_settings%ROWTYPE;
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
  SELECT * INTO s FROM public.clinic_settings c WHERE c."clinicId" = v_appt."clinicId";
  -- Only if nobody changed it meanwhile (status and time as read above).
  UPDATE public.appointments
     SET "startsAt" = p_starts_at, "durationMinutes" = s."slotMinutes",
         status = CASE WHEN s."bookingNeedsApproval" THEN 'PENDING_APPROVAL' ELSE 'CONFIRMED' END::public."AppointmentStatus",
         "approvedAt" = CASE WHEN s."bookingNeedsApproval" THEN NULL ELSE pg_catalog.now() END,
         "approvedByUserId" = NULL, "updatedAt" = pg_catalog.now()
   WHERE id = v_appt.id AND status = v_appt.status AND "startsAt" = v_appt."startsAt";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient booking: NOT_CHANGEABLE' USING ERRCODE = '22023';
  END IF;
END
$$;

-- Approval re-checks the request's own time span for overlaps (any start time).
CREATE OR REPLACE FUNCTION app.approve_patient_booking(p_appointment_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_appt public.appointments%ROWTYPE := app.review_target(p_appointment_id);
  v_end  timestamptz;
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

  -- The same slot lock as every booking path, then the time re-checked under it.
  PERFORM app.lock_doctor_slot(v_appt."doctorId", v_appt."startsAt");
  v_end := v_appt."startsAt" + pg_catalog.make_interval(mins => v_appt."durationMinutes");
  IF EXISTS (SELECT 1 FROM app.doctor_bookings_overlapping(v_appt."doctorId", v_appt."startsAt", v_end, v_appt.id)) THEN
    RAISE EXCEPTION 'booking review: SLOT_TAKEN' USING ERRCODE = '23505';
  END IF;
  IF app.patient_bookings_overlapping(v_appt."patientId", v_appt."startsAt", v_end, v_appt.id) THEN
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

-- ---------------------------------------------------------------------------
-- Invoice numbers: the clinic's prefix (default '<clinic code>-INV-')
-- ---------------------------------------------------------------------------
-- A new prefix starts its own sequence at 0001; numbers stay unique per clinic.
CREATE FUNCTION app.invoice_number_prefix(p_clinic uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = '' AS
$$
  SELECT coalesce(s."invoicePrefix", c.code || '-INV-')
    FROM public.clinics c LEFT JOIN public.clinic_settings s ON s."clinicId" = c.id
   WHERE c.id = p_clinic
$$;
REVOKE ALL ON FUNCTION app.invoice_number_prefix(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.next_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_code text;
  v_prefix text;
  v_next integer;
BEGIN
  IF v_clinic IS NULL OR NOT app.is_staff_member() THEN
    RAISE EXCEPTION 'next_document_number: no staff context' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'invoice' THEN
    IF NOT app.staff_can(ARRAY['invoice.create', 'billing.manage']) THEN
      RAISE EXCEPTION 'next_document_number: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF p_kind = 'prescription' THEN
    IF NOT app.staff_can(ARRAY['prescription.create', 'prescription.manage']) THEN
      RAISE EXCEPTION 'next_document_number: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'next_document_number: unknown kind' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('doc-number:' || p_kind || ':' || v_clinic::text));

  IF p_kind = 'invoice' THEN
    v_prefix := app.invoice_number_prefix(v_clinic);
    SELECT coalesce(max(substr(i."invoiceNumber", length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.invoices i
    WHERE i."clinicId" = v_clinic
      AND starts_with(i."invoiceNumber", v_prefix)
      AND substr(i."invoiceNumber", length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  ELSE
    SELECT code INTO v_code FROM public.clinics WHERE id = v_clinic;
    v_prefix := v_code || '-RX-';
    SELECT coalesce(max(substr(p."prescriptionNumber", length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.prescriptions p
    WHERE p."clinicId" = v_clinic
      AND starts_with(p."prescriptionNumber", v_prefix)
      AND substr(p."prescriptionNumber", length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  END IF;

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END
$$;

CREATE OR REPLACE FUNCTION app.allocate_invoice_number(p_clinic uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_prefix text;
  v_next integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('doc-number:invoice:' || p_clinic::text));
  v_prefix := app.invoice_number_prefix(p_clinic);
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(pg_catalog.substr(i."invoiceNumber", pg_catalog.length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.invoices i
   WHERE i."clinicId" = p_clinic AND pg_catalog.starts_with(i."invoiceNumber", v_prefix)
     AND pg_catalog.substr(i."invoiceNumber", pg_catalog.length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  RETURN v_prefix || pg_catalog.lpad(v_next::text, 4, '0');
END
$$;

-- ---------------------------------------------------------------------------
-- Public website: each clinic's opening hours and how online booking works
-- ---------------------------------------------------------------------------
-- Same listing as before, plus per clinic: weekly hours, whether it takes
-- online bookings and whether reception approves them. Nothing else from the
-- settings (no logo, GSTIN or billing details).
CREATE OR REPLACE FUNCTION app.public_doctor_directory() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  WITH branches AS (
    SELECT b.id, b."clinicId", b.name, b.city, b."addressLine", b.phone, b."isHeadOffice"
      FROM public.branches b JOIN public.clinics c ON c.id = b."clinicId"
     WHERE b.status = 'ACTIVE' AND c.status = 'ACTIVE'
  ), doctors AS (
    SELECT d.id, d."clinicId", u.name, s.name AS specialty, dep.name AS department, d.qualifications, d."experienceYears",
           d."consultationFeePaise", d."onlineConsultation", d.bio,
           (SELECT coalesce(pg_catalog.jsonb_agg(db."branchId" ORDER BY db."isPrimary" DESC, db."branchId"), '[]'::jsonb)
              FROM public.doctor_branches db JOIN branches b ON b.id = db."branchId"
             WHERE db."doctorId" = d.id AND db."clinicId" = d."clinicId") AS "branchIds"
      FROM public.doctor_profiles d
      JOIN public.users u ON u.id = d."userId" AND u.status <> 'DISABLED'
      JOIN public.specialties s ON s.id = d."specialtyId"
      LEFT JOIN public.departments dep ON dep.id = d."departmentId" AND dep."clinicId" = d."clinicId" AND dep.status = 'ACTIVE'
      JOIN public.clinics c ON c.id = d."clinicId" AND c.status = 'ACTIVE'
     WHERE d.status = 'ACTIVE'
  )
  SELECT pg_catalog.jsonb_build_object(
    'clinics', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'phone', c.phone,
                   'hours', s."weeklyHours", 'onlineBooking', coalesce(s."onlineBookingEnabled", true), 'needsApproval', coalesce(s."bookingNeedsApproval", true)) ORDER BY c.name), '[]'::jsonb)
                  FROM public.clinics c LEFT JOIN public.clinic_settings s ON s."clinicId" = c.id
                 WHERE c.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM branches b WHERE b."clinicId" = c.id)),
    'branches', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', b.id, 'clinicId', b."clinicId", 'name', b.name, 'city', b.city,
                   'address', b."addressLine", 'phone', b.phone) ORDER BY b."isHeadOffice" DESC, b.name), '[]'::jsonb) FROM branches b),
    'doctors', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', d.id, 'clinicId', d."clinicId", 'name', d.name, 'specialty', d.specialty,
                   'department', d.department, 'qualifications', d.qualifications, 'experienceYears', d."experienceYears",
                   'consultationFeePaise', d."consultationFeePaise", 'onlineConsultation', d."onlineConsultation", 'bio', d.bio,
                   'branchIds', d."branchIds") ORDER BY d.name, d.id), '[]'::jsonb)
                  FROM doctors d WHERE pg_catalog.jsonb_array_length(d."branchIds") > 0)
  )
$$;

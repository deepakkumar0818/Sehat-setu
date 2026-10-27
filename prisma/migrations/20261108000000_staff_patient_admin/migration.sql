-- Administrators manage staff and patients: edit a staff member's name, delete
-- a staff member, delete a patient with no history. (Blocking is an ordinary
-- status update under the existing policies; see src/server/data/people.ts and
-- src/server/data/patients.ts.) Adds three functions; touches no table,
-- column, policy or row.
--
-- The runtime role has only SELECT on users and no DELETE on any table, so
-- each change goes through a SECURITY DEFINER function that re-checks, inside
-- the database, the caller ('user.disable' — Administrators — or 'user.update'
-- for the name), the clinic and the target.

-- 1. app.set_staff_name: the name lives on users.name, shared by every clinic
--    the person belongs to — changed only when no other clinic is involved,
--    like app.set_staff_phone (20261020000100).
CREATE FUNCTION app.set_staff_name(p_membership_id uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_branch uuid := app.current_branch_id();
  v_name   text := pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_m      public.clinic_memberships%ROWTYPE;
  v_role   text;
BEGIN
  IF app.current_user_id() IS NULL OR v_clinic IS NULL OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['user.update']) THEN
    RAISE EXCEPTION 'staff admin: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'staff admin: INVALID_NAME' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_m FROM public.clinic_memberships m WHERE m.id = p_membership_id FOR UPDATE;
  SELECT r.key::text INTO v_role FROM public.roles r WHERE r.id = v_m."roleId";
  IF v_m.id IS NULL OR v_m."clinicId" <> v_clinic OR v_role IS NULL OR v_role = 'PATIENT'
     OR (v_branch IS NOT NULL AND v_m."branchId" IS DISTINCT FROM v_branch) THEN
    RAISE EXCEPTION 'staff admin: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_memberships o WHERE o."userId" = v_m."userId" AND o."clinicId" <> v_clinic)
     OR EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_m."userId" AND p."clinicId" <> v_clinic) THEN
    RAISE EXCEPTION 'staff admin: SHARED_ACCOUNT' USING ERRCODE = '55000';
  END IF;

  UPDATE public.users SET name = v_name, "updatedAt" = pg_catalog.now()
   WHERE id = v_m."userId" AND name IS DISTINCT FROM v_name;
  IF FOUND THEN
    PERFORM app.log_event('staff.name_updated', 'SUCCESS', 'clinic_memberships', v_m.id::text, NULL, NULL, NULL,
      pg_catalog.jsonb_build_object('userId', v_m."userId"));
  END IF;
  RETURN v_m.id;
END
$$;
REVOKE ALL ON FUNCTION app.set_staff_name(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_staff_name(uuid, text) TO sehat_app;

-- 2. app.remove_staff_member: deletes a (non-doctor, non-patient) staff
--    membership and the accepted invitation that created it. Never the
--    caller's own, never the clinic's last active Administrator. The login
--    (users) is kept, and so is everything they recorded (records name the
--    user, not the membership). Doctors go through app.remove_doctor.
CREATE FUNCTION app.remove_staff_member(p_membership_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_branch uuid := app.current_branch_id();
  v_m      public.clinic_memberships%ROWTYPE;
  v_role   text;
BEGIN
  IF app.current_user_id() IS NULL OR v_clinic IS NULL OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['user.disable']) THEN
    RAISE EXCEPTION 'staff admin: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  -- One decision per clinic at a time, so two admins can't remove each other.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:staff-admin:' || v_clinic::text, 0));

  SELECT * INTO v_m FROM public.clinic_memberships m WHERE m.id = p_membership_id FOR UPDATE;
  SELECT r.key::text INTO v_role FROM public.roles r WHERE r.id = v_m."roleId";
  IF v_m.id IS NULL OR v_m."clinicId" <> v_clinic OR v_role IS NULL OR v_role IN ('PATIENT', 'DOCTOR')
     OR (v_branch IS NOT NULL AND v_m."branchId" IS DISTINCT FROM v_branch) THEN
    RAISE EXCEPTION 'staff admin: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_m."userId" = app.current_user_id() THEN
    RAISE EXCEPTION 'staff admin: SELF' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'ADMINISTRATOR' AND v_m.status = 'ACTIVE' AND NOT EXISTS (
       SELECT 1 FROM public.clinic_memberships o JOIN public.roles r ON r.id = o."roleId"
        WHERE o."clinicId" = v_clinic AND o.id <> v_m.id AND o.status = 'ACTIVE' AND r.key = 'ADMINISTRATOR') THEN
    RAISE EXCEPTION 'staff admin: LAST_ADMIN' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.staff_invitation_doctor_details dd USING public.staff_invitations i
   WHERE dd."invitationId" = i.id AND i."membershipId" = v_m.id;
  DELETE FROM public.staff_invitations i WHERE i."membershipId" = v_m.id;
  DELETE FROM public.clinic_memberships m WHERE m.id = v_m.id;
  PERFORM app.log_event('staff.removed', 'SUCCESS', 'clinic_memberships', v_m.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('userId', v_m."userId", 'role', v_role));
  RETURN 'REMOVED';
END
$$;
REVOKE ALL ON FUNCTION app.remove_staff_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_staff_member(uuid) TO sehat_app;

-- 3. app.remove_patient: deletes a patient record with NO clinical or billing
--    history — any appointment, bill, lab report, document, online payment or
--    symptom report means 'HAS_HISTORY' and nothing is deleted (block the
--    patient instead: medical and billing records are kept). Also removed:
--    their linking codes, intake form and their PATIENT membership in this
--    clinic (portal access). Their login (users) is kept.
CREATE FUNCTION app.remove_patient(p_patient_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_p      public.patients%ROWTYPE;
BEGIN
  IF app.current_user_id() IS NULL OR v_clinic IS NULL OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['user.disable']) THEN
    RAISE EXCEPTION 'patient admin: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = v_clinic FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'patient admin: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id)
     OR EXISTS (SELECT 1 FROM public.invoices x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id)
     OR EXISTS (SELECT 1 FROM public.lab_reports x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id)
     OR EXISTS (SELECT 1 FROM public.patient_documents x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id)
     OR EXISTS (SELECT 1 FROM public.online_payment_orders x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id)
     OR EXISTS (SELECT 1 FROM public.patient_symptom_reports x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id) THEN
    PERFORM app.log_event('patient.remove_refused', 'DENIED', 'patients', v_p.id::text, 'has_history', NULL, NULL, NULL);
    RETURN 'HAS_HISTORY';
  END IF;

  DELETE FROM public.patient_link_codes x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id;
  DELETE FROM public.patient_intake_profiles x WHERE x."clinicId" = v_clinic AND x."patientId" = v_p.id;
  IF v_p."userId" IS NOT NULL THEN
    DELETE FROM public.clinic_memberships m USING public.roles r
     WHERE r.id = m."roleId" AND r.key = 'PATIENT' AND m."clinicId" = v_clinic AND m."userId" = v_p."userId";
  END IF;
  DELETE FROM public.patients p WHERE p.id = v_p.id;
  PERFORM app.log_event('patient.removed', 'SUCCESS', 'patients', v_p.id::text, NULL, NULL, NULL, NULL);
  RETURN 'REMOVED';
END
$$;
REVOKE ALL ON FUNCTION app.remove_patient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_patient(uuid) TO sehat_app;

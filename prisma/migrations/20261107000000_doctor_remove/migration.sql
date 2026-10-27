-- Removing a doctor from a clinic (Doctors → ⋯ → Delete).
--
-- Suspending is an ordinary update (doctor_profiles.status and the doctor's
-- membership, under the existing update policies). Deleting has no policy on
-- purpose — the runtime role can't DELETE these tables — so it goes through
-- app.remove_doctor, which re-checks the caller and refuses a doctor with any
-- appointment or lab report: those are patients' medical records and stay,
-- with the doctor they name (suspend such a doctor instead).
--
-- Removed: the doctor profile (its branch links cascade), the doctor's DOCTOR
-- membership in this clinic (its permission changes cascade) and the accepted
-- invitation that created it. The person's login (users) is kept: they may
-- work at other clinics, and can be invited again. The audit trail keeps the
-- history (audit_row_change on memberships and invitations, plus the event).

CREATE FUNCTION app.remove_doctor(p_doctor uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic  uuid := app.current_clinic_id();
  v_user    uuid;
  v_members uuid[];
BEGIN
  IF v_clinic IS NULL OR NOT app.staff_can(ARRAY['doctor.manage']) THEN
    RAISE EXCEPTION 'doctor remove: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT d."userId" INTO v_user FROM public.doctor_profiles d WHERE d.id = p_doctor AND d."clinicId" = v_clinic FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'doctor remove: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_user = app.current_user_id() THEN
    RAISE EXCEPTION 'doctor remove: SELF' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a WHERE a."clinicId" = v_clinic AND a."doctorId" = p_doctor)
     OR EXISTS (SELECT 1 FROM public.lab_reports l WHERE l."clinicId" = v_clinic AND l."orderedByDoctorId" = p_doctor) THEN
    PERFORM app.log_event('doctor.remove_refused', 'DENIED', 'doctor_profiles', p_doctor::text, 'has_history', NULL, NULL, NULL);
    RETURN 'HAS_HISTORY';
  END IF;

  SELECT pg_catalog.array_agg(m.id) INTO v_members
    FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
   WHERE m."clinicId" = v_clinic AND m."userId" = v_user AND r.key = 'DOCTOR';

  DELETE FROM public.doctor_profiles d WHERE d.id = p_doctor AND d."clinicId" = v_clinic;
  IF v_members IS NOT NULL THEN
    DELETE FROM public.staff_invitation_doctor_details dd
     USING public.staff_invitations i
     WHERE dd."invitationId" = i.id AND i."membershipId" = ANY (v_members);
    DELETE FROM public.staff_invitations i WHERE i."membershipId" = ANY (v_members);
    DELETE FROM public.clinic_memberships m WHERE m.id = ANY (v_members);
  END IF;
  PERFORM app.log_event('doctor.removed', 'SUCCESS', 'doctor_profiles', p_doctor::text, NULL, NULL, NULL, NULL);
  RETURN 'REMOVED';
END
$$;
REVOKE ALL ON FUNCTION app.remove_doctor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_doctor(uuid) TO sehat_app;

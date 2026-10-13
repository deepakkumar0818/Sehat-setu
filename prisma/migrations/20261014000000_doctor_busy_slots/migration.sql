-- Double-booking protection across visibility boundaries.
--
-- RLS correctly hides appointments a user may not see (another branch, another
-- doctor's patients). But "is this doctor free at 10:30?" must consider EVERY
-- booking, or a branch-restricted receptionist could double-book a doctor who
-- also works at another branch. This function answers only that question: it
-- returns busy START TIMES (no patient, reason, or appointment ids) for one
-- doctor of the caller's own clinic, to verified staff only, over at most 31 days.
-- Additive: no table or column changes.

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
    AND a.status::text <> ALL (ARRAY['CANCELLED', 'NO_SHOW'])
$$;

REVOKE ALL ON FUNCTION app.doctor_busy_slots(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.doctor_busy_slots(uuid, timestamptz, timestamptz) TO sehat_app;

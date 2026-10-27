-- Clinic patient link (/join/<CODE>): each clinic shares its own registration
-- and booking link, and patients who register through it join that clinic.
--
-- * app.public_clinic_by_code: the signed-out lookup behind the link — name and
--   city of an ACTIVE clinic with at least one ACTIVE branch, or null. Like
--   app.public_doctor_directory it runs as the runtime role with no user
--   context, and reveals nothing the public directory doesn't already list.
--   app.register_self_patient already takes the clinic code; the link only
--   decides which code it gets (src/server/data/patient-link.ts).

CREATE FUNCTION app.public_clinic_by_code(p_code text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT pg_catalog.jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'city', c.city)
    FROM public.clinics c
   WHERE pg_catalog.upper(c.code) = pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')))
     AND c.status = 'ACTIVE'
     AND EXISTS (SELECT 1 FROM public.branches b WHERE b."clinicId" = c.id AND b.status = 'ACTIVE')
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.public_clinic_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_clinic_by_code(text) TO sehat_app;

-- Public doctor directory: what the signed-out website (/doctors, the home page,
-- doctor profiles) may show about each ACTIVE doctor practising at an ACTIVE
-- branch of an ACTIVE clinic. RLS returns nothing without a signed-in member,
-- so this SECURITY DEFINER function is the only public read path, and it
-- returns only listing fields:
--   doctor: id, name, specialty, department, qualifications, years of
--           experience, consultation fee, online consultation, bio, branches;
--   clinic/branch: name, city, address, phone (the clinic's public contact).
-- Never: registration numbers, emails, user ids, patients, appointments or
-- schedules. Disabled doctor accounts are left out. Read-only; additive.

CREATE FUNCTION app.public_doctor_directory() RETURNS jsonb
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
    'clinics', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'phone', c.phone) ORDER BY c.name), '[]'::jsonb)
                  FROM public.clinics c WHERE c.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM branches b WHERE b."clinicId" = c.id)),
    'branches', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', b.id, 'clinicId', b."clinicId", 'name', b.name, 'city', b.city,
                   'address', b."addressLine", 'phone', b.phone) ORDER BY b."isHeadOffice" DESC, b.name), '[]'::jsonb) FROM branches b),
    'doctors', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', d.id, 'clinicId', d."clinicId", 'name', d.name, 'specialty', d.specialty,
                   'department', d.department, 'qualifications', d.qualifications, 'experienceYears', d."experienceYears",
                   'consultationFeePaise', d."consultationFeePaise", 'onlineConsultation', d."onlineConsultation", 'bio', d.bio,
                   'branchIds', d."branchIds") ORDER BY d.name, d.id), '[]'::jsonb)
                  FROM doctors d WHERE pg_catalog.jsonb_array_length(d."branchIds") > 0)
  )
$$;

REVOKE ALL ON FUNCTION app.public_doctor_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_doctor_directory() TO sehat_app;

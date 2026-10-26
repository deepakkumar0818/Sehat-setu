-- Clinic-specific specialties: a clinic's administrators add specialties of
-- their own next to the shared catalogue.
-- * specialties."clinicId": NULL = shared by every clinic (the existing rows,
--   unchanged); set = that clinic's own, visible to that clinic only.
-- * Names: shared ones stay unique (now ignoring case); a clinic's own are
--   unique within the clinic and may not repeat a shared name.
-- * Adding and renaming a clinic's own specialty need clinic.settings.manage and
--   a clinic-wide membership. Never deleted (doctors and departments refer to them).
-- * A doctor profile, department or doctor invitation can only use a shared
--   specialty or its own clinic's (checked in the database, whoever writes).
-- * Audited like the other setup tables.
-- Changes to existing objects: specialties_name_key (global unique name) is
-- replaced by the two indexes below, and specialties_read now hides other
-- clinics' own specialties. No existing row changes.

ALTER TABLE specialties ADD COLUMN "clinicId" uuid REFERENCES clinics(id) ON DELETE RESTRICT;
ALTER TABLE specialties ADD CONSTRAINT specialties_name_trimmed CHECK ("clinicId" IS NULL OR ("name" = btrim("name") AND length("name") BETWEEN 1 AND 80));

DROP INDEX specialties_name_key;
CREATE UNIQUE INDEX specialties_shared_name_key ON specialties (lower("name")) WHERE "clinicId" IS NULL;
CREATE UNIQUE INDEX specialties_clinic_name_key ON specialties ("clinicId", lower("name")) WHERE "clinicId" IS NOT NULL;

-- A clinic's own specialty may not repeat a shared name.
CREATE FUNCTION app.check_specialty_name() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF NEW."clinicId" IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.specialties s WHERE s."clinicId" IS NULL AND lower(s.name) = lower(NEW.name)) THEN
    RAISE EXCEPTION 'specialty: SHARED_NAME' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_specialty_name BEFORE INSERT OR UPDATE OF "name", "clinicId" ON specialties FOR EACH ROW EXECUTE FUNCTION app.check_specialty_name();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
GRANT INSERT ("id", "clinicId", "name", "description", "updatedAt") ON specialties TO sehat_app;
GRANT UPDATE ("name", "description", "updatedAt") ON specialties TO sehat_app;

DROP POLICY specialties_read ON specialties;
CREATE POLICY specialties_read ON specialties FOR SELECT TO sehat_app USING (
  "clinicId" IS NULL OR "clinicId" = (SELECT app.current_clinic_id())
);
CREATE POLICY specialties_insert ON specialties FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (SELECT app.current_branch_id()) IS NULL
  AND (SELECT app.staff_can(ARRAY['clinic.settings.manage']))
);
CREATE POLICY specialties_update ON specialties FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id())
         AND (SELECT app.current_branch_id()) IS NULL
         AND (SELECT app.staff_can(ARRAY['clinic.settings.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE TRIGGER audit_specialties AFTER INSERT OR UPDATE OR DELETE ON specialties FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Users of a specialty stay within their clinic
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.check_specialty_scope() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF NEW."specialtyId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.specialties s
        WHERE s.id = NEW."specialtyId" AND (s."clinicId" IS NULL OR s."clinicId" = NEW."clinicId")) THEN
    IF TG_TABLE_NAME = 'staff_invitation_doctor_details' THEN
      RAISE EXCEPTION 'staff invitation: INVALID_SPECIALTY' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'specialty: NOT_AVAILABLE' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_specialty_scope BEFORE INSERT OR UPDATE OF "specialtyId", "clinicId" ON doctor_profiles FOR EACH ROW EXECUTE FUNCTION app.check_specialty_scope();
CREATE TRIGGER check_specialty_scope BEFORE INSERT OR UPDATE OF "specialtyId", "clinicId" ON departments FOR EACH ROW EXECUTE FUNCTION app.check_specialty_scope();
CREATE TRIGGER check_specialty_scope BEFORE INSERT OR UPDATE OF "specialtyId", "clinicId" ON staff_invitation_doctor_details FOR EACH ROW EXECUTE FUNCTION app.check_specialty_scope();

REVOKE ALL ON FUNCTION app.check_specialty_name(), app.check_specialty_scope() FROM PUBLIC;

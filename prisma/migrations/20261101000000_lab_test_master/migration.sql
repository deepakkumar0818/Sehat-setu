-- Lab test master: each clinic's own list of tests a doctor can order from a
-- consultation (the "Order a test..." suggestions), managed by its administrators.
-- * lab_test_types: one row per test name per clinic, never deleted; a test that
--   is no longer offered is deactivated. Names are unique per clinic, ignoring case.
-- * Every staff member of the clinic can read the list (doctors order from it);
--   adding, renaming and deactivating need clinic.settings.manage and a
--   clinic-wide (not branch-restricted) membership, as for clinic-wide departments.
-- * Each clinic starts with the standard tests (the list the app had built in),
--   existing clinics now and new clinics on creation (seed trigger on clinics).
-- * Audited like the other setup tables (who changed which columns; no values).
-- Additive only: no existing table, column, policy or grant is changed.

CREATE TYPE "LabTestCategory" AS ENUM ('PATHOLOGY', 'RADIOLOGY', 'CARDIOLOGY', 'OTHER');

CREATE TABLE "lab_test_types" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"  uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "name"      text NOT NULL CHECK ("name" = btrim("name") AND length("name") BETWEEN 1 AND 60),
  "category"  "LabTestCategory" NOT NULL DEFAULT 'OTHER',
  "status"    "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT lab_test_types_clinic_id_key UNIQUE ("clinicId", id)
);
CREATE UNIQUE INDEX lab_test_types_clinic_name_key ON lab_test_types ("clinicId", lower("name"));

-- ---------------------------------------------------------------------------
-- Privileges: no DELETE; the clinic of a row never changes
-- ---------------------------------------------------------------------------
REVOKE ALL ON lab_test_types FROM anon, authenticated;
GRANT SELECT ON lab_test_types TO sehat_app;
GRANT INSERT ("id", "clinicId", "name", "category", "updatedAt") ON lab_test_types TO sehat_app;
GRANT UPDATE ("name", "category", "status", "updatedAt") ON lab_test_types TO sehat_app;

-- ---------------------------------------------------------------------------
-- RLS: clinic isolation; changes by clinic-wide administrators only
-- ---------------------------------------------------------------------------
ALTER TABLE lab_test_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY lab_test_types_read ON lab_test_types FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
);
CREATE POLICY lab_test_types_insert ON lab_test_types FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (SELECT app.current_branch_id()) IS NULL
  AND (SELECT app.staff_can(ARRAY['clinic.settings.manage']))
);
CREATE POLICY lab_test_types_update ON lab_test_types FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id())
         AND (SELECT app.current_branch_id()) IS NULL
         AND (SELECT app.staff_can(ARRAY['clinic.settings.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE TRIGGER audit_lab_test_types AFTER INSERT OR UPDATE OR DELETE ON lab_test_types FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Standard tests for every clinic (not callable by the app role)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.seed_lab_test_types(p_clinic_id uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
  INSERT INTO public.lab_test_types ("clinicId", "name", "category")
  SELECT p_clinic_id, t.name, t.category::public."LabTestCategory"
  FROM (VALUES
    ('CBC', 'PATHOLOGY'), ('LFT', 'PATHOLOGY'), ('KFT', 'PATHOLOGY'), ('Lipid Profile', 'PATHOLOGY'),
    ('X-Ray', 'RADIOLOGY'), ('MRI', 'RADIOLOGY'), ('CT Scan', 'RADIOLOGY'), ('Ultrasound', 'RADIOLOGY'),
    ('ECG', 'CARDIOLOGY')
  ) AS t(name, category)
  ON CONFLICT DO NOTHING;
$$;

CREATE FUNCTION app.seed_new_clinic_lab_tests() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.seed_lab_test_types(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app.seed_lab_test_types(uuid), app.seed_new_clinic_lab_tests() FROM PUBLIC;

CREATE TRIGGER seed_lab_test_types AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION app.seed_new_clinic_lab_tests();

SELECT app.seed_lab_test_types(id) FROM clinics;

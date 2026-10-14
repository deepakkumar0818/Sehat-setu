-- P6.2: lab reports and patient documents (approved design). NOT YET APPLIED —
-- apply only after the dry run (prisma/p62-dry-run.ts) and explicit approval.
-- Marker: P6.2-DOCS-1
--
-- * Files live in a PRIVATE Supabase Storage bucket ("patient-documents") that
--   only the server's secret key can reach. This migration does not create the
--   bucket (prisma/p62-storage-setup.ts does, separately and only on approval).
--   The database row is the authorization gate: the server writes a file only
--   under the key returned by app.begin_patient_document_upload (which checks
--   the caller here), and reads a file only after reading its row through RLS.
--   The storage key is derived from the row ("clinicId/id"), never from a request.
-- * Two document classes. CLINICAL (lab reports, imaging, discharge summaries,
--   referrals, other clinical) and ADMINISTRATIVE (ID proof, insurance, consent,
--   other administrative). Reads (RLS, below):
--     - clinical: administrators (medical_record.view/manage, lab.manage) within
--       their branch scope; doctors for patients they have an appointment with,
--       in ANY branch of the clinic (continuity of care); other lab_report.view
--       holders (nurses) within their branch scope;
--     - administrative: patient_document.view holders within their branch scope;
--     - patients (portal, later): only lab-report files of reports that a
--       clinician reviewed and shared with them.
--   Receptionists may UPLOAD clinical files (lab_report.upload) but can't read
--   them back: every write goes through the functions below, which return ids only.
-- * The runtime role gets SELECT on the two tables and nothing else; every write
--   is a SECURITY DEFINER function that re-checks the caller from the pinned
--   session. There is no DELETE: documents are archived, never removed.
-- * Audit: row triggers (ids + changed column names only) plus explicit events
--   (document.uploaded / upload_failed / archived, lab_report.created /
--   values_updated / reviewed / shared / unshared). Event metadata carries ids,
--   category, type and size — never titles, filenames, values, notes or names.
--   File views/downloads are audited by the server (document.viewed) through
--   app.log_event in the same transaction that authorizes them.
-- * Permissions (agreed matrix): new keys patient_document.upload / .view /
--   .manage; existing lab_report.upload and lab_result.update are granted for
--   the first time. Nothing existing is modified or dropped.
-- * Errors are 'patient document: <CODE>' / 'lab report: <CODE>' so the server
--   maps them to API errors without parsing prose.

-- 1. Types.
CREATE TYPE "DocumentCategory" AS ENUM (
  'LAB_REPORT', 'IMAGING', 'DISCHARGE_SUMMARY', 'REFERRAL', 'CLINICAL_OTHER',
  'ID_PROOF', 'INSURANCE', 'CONSENT', 'ADMIN_OTHER'
);
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'AVAILABLE', 'FAILED', 'ARCHIVED');
CREATE TYPE "DocumentArchiveReason" AS ENUM ('UPLOADED_IN_ERROR', 'WRONG_PATIENT', 'DUPLICATE', 'ILLEGIBLE', 'SUPERSEDED', 'OTHER');
CREATE TYPE "LabReportStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVIEWED');

-- 2. Tables.
CREATE TABLE "lab_reports" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"            UUID NOT NULL,
  "branchId"            UUID NOT NULL,
  "patientId"           UUID NOT NULL,
  "consultationId"      UUID,
  "orderedByDoctorId"   UUID,
  "testType"            TEXT NOT NULL,
  "title"               TEXT NOT NULL,
  "status"              "LabReportStatus" NOT NULL DEFAULT 'PENDING',
  "resultDate"          DATE,
  "values"              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "notes"               TEXT,
  "reviewedByUserId"    UUID,
  "reviewedAt"          TIMESTAMPTZ(6),
  "sharedWithPatientAt" TIMESTAMPTZ(6),
  "sharedByUserId"      UUID,
  "createdByUserId"     UUID NOT NULL,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lab_reports_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_clinicId_branchId_fkey" FOREIGN KEY ("clinicId", "branchId") REFERENCES "branches"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_clinicId_patientId_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "patients"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_clinicId_consultationId_fkey" FOREIGN KEY ("clinicId", "consultationId") REFERENCES "consultations"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_clinicId_orderedByDoctorId_fkey" FOREIGN KEY ("clinicId", "orderedByDoctorId") REFERENCES "doctor_profiles"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_reports_testType_len" CHECK (char_length("testType") BETWEEN 1 AND 60),
  CONSTRAINT "lab_reports_title_len" CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "lab_reports_notes_len" CHECK ("notes" IS NULL OR char_length("notes") <= 4000),
  CONSTRAINT "lab_reports_values_shape" CHECK (jsonb_typeof("values") = 'array' AND pg_column_size("values") <= 16384),
  -- A report is REVIEWED exactly when a reviewer and time are recorded; only a reviewed report can be shared.
  CONSTRAINT "lab_reports_review_consistent" CHECK (("status" = 'REVIEWED') = ("reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL)),
  CONSTRAINT "lab_reports_share_requires_review" CHECK ("sharedWithPatientAt" IS NULL OR ("status" = 'REVIEWED' AND "sharedByUserId" IS NOT NULL))
);
CREATE UNIQUE INDEX "lab_reports_clinicId_id_key" ON "lab_reports"("clinicId", "id");
CREATE INDEX "lab_reports_clinicId_patientId_idx" ON "lab_reports"("clinicId", "patientId");
CREATE INDEX "lab_reports_clinicId_status_createdAt_idx" ON "lab_reports"("clinicId", "status", "createdAt");

CREATE TABLE "patient_documents" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"         UUID NOT NULL,
  "branchId"         UUID NOT NULL,
  "patientId"        UUID NOT NULL,
  "labReportId"      UUID,
  "consultationId"   UUID,
  "category"         "DocumentCategory" NOT NULL,
  "title"            TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "sizeBytes"        INTEGER NOT NULL,
  "sha256"           TEXT NOT NULL,
  "storageKey"       TEXT NOT NULL,
  "status"           "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
  "uploadedByUserId" UUID NOT NULL,
  "uploadedAt"       TIMESTAMPTZ(6),
  "failedAt"         TIMESTAMPTZ(6),
  "archivedAt"       TIMESTAMPTZ(6),
  "archivedByUserId" UUID,
  "archiveReason"    "DocumentArchiveReason",
  "archiveNote"      TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_documents_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_clinicId_branchId_fkey" FOREIGN KEY ("clinicId", "branchId") REFERENCES "branches"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_clinicId_patientId_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "patients"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_clinicId_labReportId_fkey" FOREIGN KEY ("clinicId", "labReportId") REFERENCES "lab_reports"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_clinicId_consultationId_fkey" FOREIGN KEY ("clinicId", "consultationId") REFERENCES "consultations"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_documents_storageKey_key" UNIQUE ("storageKey"),
  -- The object key is derived from the row: no request can point a row at another clinic's file.
  CONSTRAINT "patient_documents_storageKey_derived" CHECK ("storageKey" = "clinicId"::text || '/' || "id"::text),
  CONSTRAINT "patient_documents_mime_allowed" CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT "patient_documents_size_limit" CHECK ("sizeBytes" BETWEEN 1 AND 8388608),
  CONSTRAINT "patient_documents_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "patient_documents_title_len" CHECK (char_length("title") BETWEEN 1 AND 200),
  -- Display name only (never a storage path): no separators or control characters.
  CONSTRAINT "patient_documents_filename_safe" CHECK (char_length("originalFilename") BETWEEN 1 AND 200 AND "originalFilename" !~ '[/\\[:cntrl:]]'),
  CONSTRAINT "patient_documents_archive_note_len" CHECK ("archiveNote" IS NULL OR char_length("archiveNote") <= 500),
  CONSTRAINT "patient_documents_lab_link" CHECK ("labReportId" IS NULL OR "category" = 'LAB_REPORT'),
  CONSTRAINT "patient_documents_status_consistent" CHECK (
    ("status" <> 'AVAILABLE' OR "uploadedAt" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "failedAt" IS NOT NULL)
    AND (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL AND "archivedByUserId" IS NOT NULL AND "archiveReason" IS NOT NULL))
  )
);
CREATE INDEX "patient_documents_clinicId_patientId_status_idx" ON "patient_documents"("clinicId", "patientId", "status");
CREATE INDEX "patient_documents_clinicId_labReportId_idx" ON "patient_documents"("clinicId", "labReportId");
CREATE INDEX "patient_documents_clinicId_patientId_sha256_idx" ON "patient_documents"("clinicId", "patientId", "sha256");
CREATE INDEX "patient_documents_status_createdAt_idx" ON "patient_documents"("status", "createdAt");

-- 3. Visibility helpers used by the policies and the write functions.
--    clinical_record_visible is SECURITY DEFINER (like app.staff_can): its
--    appointments lookup filters explicitly by clinic and by the caller's own
--    doctor profile, and must NOT inherit the appointments policy's branch
--    filter — doctors keep access to their patients across branches.
CREATE FUNCTION app.document_is_clinical(p_category "DocumentCategory") RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT p_category IN ('LAB_REPORT', 'IMAGING', 'DISCHARGE_SUMMARY', 'REFERRAL', 'CLINICAL_OTHER') $$;

CREATE FUNCTION app.clinical_record_visible(p_patient_id uuid, p_branch_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT app.is_staff_member()
  -- Defence in depth: the patient and the branch must both belong to the caller's clinic,
  -- whatever the calling policy or function already checked.
  AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b."clinicId" = app.current_clinic_id())
  AND (
    -- Administrators: within their own branch scope (clinic-wide when unrestricted).
    (app.staff_can(ARRAY['medical_record.view', 'medical_record.manage', 'lab.manage']) AND app.branch_visible(p_branch_id))
    -- Doctors: patients they have an appointment with, in any branch of this clinic (continuity of care).
    OR (app.current_doctor_id() IS NOT NULL AND app.staff_can(ARRAY['patient.medical_record.view'])
        AND EXISTS (SELECT 1 FROM public.appointments a
                    WHERE a."clinicId" = app.current_clinic_id() AND a."patientId" = p_patient_id AND a."doctorId" = app.current_doctor_id()))
    -- Other clinical staff (nurses): lab_report.view within their branch scope. Never doctors, who are assignment-scoped above.
    OR (app.current_doctor_id() IS NULL AND app.staff_can(ARRAY['lab_report.view']) AND app.branch_visible(p_branch_id))
  )
$$;

CREATE FUNCTION app.admin_document_visible(p_branch_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS
$$ SELECT app.is_staff_member() AND app.staff_can(ARRAY['patient_document.view']) AND app.branch_visible(p_branch_id)
     AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b."clinicId" = app.current_clinic_id()) $$;

REVOKE ALL ON FUNCTION app.document_is_clinical("DocumentCategory"), app.clinical_record_visible(uuid, uuid), app.admin_document_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.document_is_clinical("DocumentCategory"), app.clinical_record_visible(uuid, uuid), app.admin_document_visible(uuid) TO sehat_app;

-- 4. Read access (the runtime role: SELECT only; no INSERT, UPDATE or DELETE).
REVOKE ALL ON lab_reports, patient_documents FROM anon, authenticated;
ALTER TABLE "lab_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_documents" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON lab_reports, patient_documents TO sehat_app;

CREATE POLICY lab_reports_read ON lab_reports FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (
    app.clinical_record_visible("patientId", "branchId")
    -- Patient portal (later phase): their own reports, once reviewed and shared.
    OR ("status" = 'REVIEWED' AND "sharedWithPatientAt" IS NOT NULL AND "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[]))
  )
);

CREATE POLICY patient_documents_read ON patient_documents FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND "status" IN ('AVAILABLE', 'ARCHIVED') -- uploads in progress and failed uploads are never listed
  AND (
    (app.document_is_clinical("category") AND app.clinical_record_visible("patientId", "branchId"))
    OR (NOT app.document_is_clinical("category") AND app.admin_document_visible("branchId"))
    -- Patient portal (later phase): files of their own shared lab reports (the EXISTS is filtered by lab_reports_read).
    OR ("category" = 'LAB_REPORT' AND "status" = 'AVAILABLE' AND "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
        AND EXISTS (SELECT 1 FROM public.lab_reports r WHERE r.id = "labReportId" AND r."sharedWithPatientAt" IS NOT NULL))
  )
);

-- 5. Internal checks (not granted to the runtime role).
CREATE FUNCTION app.require_document_staff() RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL OR NOT app.is_staff_member() THEN
    RAISE EXCEPTION 'patient document: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
END
$$;

-- The caller may work on this patient's records: clinic-wide patient visibility,
-- or (doctors) a patient they have an appointment with. Unknown patients and
-- other clinics' patients are indistinguishable (false).
CREATE FUNCTION app.document_patient_in_scope(p_patient_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = app.current_clinic_id())
     AND (
       app.staff_can(ARRAY['patient.view', 'patient.basic_info.view'])
       OR (app.current_doctor_id() IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.appointments a
             WHERE a."clinicId" = app.current_clinic_id() AND a."patientId" = p_patient_id AND a."doctorId" = app.current_doctor_id()))
     )
$$;

-- The branch a new record belongs to: a branch-limited caller's own branch;
-- otherwise the requested active branch, or the patient's registration branch.
CREATE FUNCTION app.document_branch(p_patient_id uuid, p_branch_id uuid) RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_branch uuid := coalesce(app.current_branch_id(), p_branch_id,
                            (SELECT p."branchId" FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = app.current_clinic_id()));
BEGIN
  IF (app.current_branch_id() IS NOT NULL AND p_branch_id IS NOT NULL AND p_branch_id <> app.current_branch_id())
     OR v_branch IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_branch AND b."clinicId" = app.current_clinic_id() AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'patient document: INVALID_BRANCH' USING ERRCODE = '22023';
  END IF;
  RETURN v_branch;
END
$$;

-- At most 30 new files and 30 new lab reports per user per 10 minutes (abuse guard; holds across server instances).
CREATE FUNCTION app.document_rate_limit() RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.patient_documents d
      WHERE d."uploadedByUserId" = app.current_user_id() AND d."createdAt" > pg_catalog.now() - interval '10 minutes') >= 30
     OR (SELECT pg_catalog.count(*) FROM public.lab_reports r
         WHERE r."createdByUserId" = app.current_user_id() AND r."createdAt" > pg_catalog.now() - interval '10 minutes') >= 30 THEN
    RAISE EXCEPTION 'patient document: RATE_LIMITED' USING ERRCODE = '55000';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.require_document_staff(), app.document_patient_in_scope(uuid), app.document_branch(uuid, uuid), app.document_rate_limit() FROM PUBLIC;

-- 6. Upload, step 1: authorize and register. Returns the id and the ONLY storage
--    key the server may write to. Nothing is visible until step 2.
CREATE FUNCTION app.begin_patient_document_upload(
  p_patient_id uuid, p_category "DocumentCategory", p_title text, p_original_filename text,
  p_mime_type text, p_size_bytes integer, p_sha256 text,
  p_branch_id uuid DEFAULT NULL, p_lab_report_id uuid DEFAULT NULL, p_consultation_id uuid DEFAULT NULL
) RETURNS TABLE (document_id uuid, storage_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_branch uuid;
  v_title  text := pg_catalog.btrim(coalesce(p_title, ''));
  v_name   text := pg_catalog.btrim(coalesce(p_original_filename, ''));
BEGIN
  PERFORM app.require_document_staff();
  -- Clinical files: lab_report.upload (receptionists upload-only, doctors for their own patients).
  -- Administrative files: patient_document.upload.
  IF p_category IS NULL
     OR (app.document_is_clinical(p_category) AND NOT app.staff_can(ARRAY['lab_report.upload']))
     OR (NOT app.document_is_clinical(p_category) AND NOT app.staff_can(ARRAY['patient_document.upload'])) THEN
    RAISE EXCEPTION 'patient document: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR NOT app.document_patient_in_scope(p_patient_id) THEN
    RAISE EXCEPTION 'patient document: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.char_length(v_title) NOT BETWEEN 1 AND 200 OR pg_catalog.char_length(v_name) NOT BETWEEN 1 AND 200
     OR v_name ~ '[/\\[:cntrl:]]'
     OR p_mime_type IS NULL OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png')
     OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 8388608
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'patient document: INVALID_FILE' USING ERRCODE = '22023';
  END IF;
  IF p_lab_report_id IS NOT NULL AND (p_category <> 'LAB_REPORT' OR NOT EXISTS (
       SELECT 1 FROM public.lab_reports r WHERE r.id = p_lab_report_id AND r."clinicId" = v_clinic AND r."patientId" = p_patient_id)) THEN
    RAISE EXCEPTION 'patient document: INVALID_LINK' USING ERRCODE = '22023';
  END IF;
  IF p_consultation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.consultations c JOIN public.appointments a ON a.id = c."appointmentId"
       WHERE c.id = p_consultation_id AND c."clinicId" = v_clinic AND a."patientId" = p_patient_id) THEN
    RAISE EXCEPTION 'patient document: INVALID_LINK' USING ERRCODE = '22023';
  END IF;
  v_branch := app.document_branch(p_patient_id, p_branch_id);
  PERFORM app.document_rate_limit();

  INSERT INTO public.patient_documents (id, "clinicId", "branchId", "patientId", "labReportId", "consultationId", category, title,
                                        "originalFilename", "mimeType", "sizeBytes", sha256, "storageKey", status, "uploadedByUserId")
  VALUES (v_id, v_clinic, v_branch, p_patient_id, p_lab_report_id, p_consultation_id, p_category, v_title,
          v_name, p_mime_type, p_size_bytes, p_sha256, v_clinic::text || '/' || v_id::text, 'UPLOADING', app.current_user_id());
  RETURN QUERY SELECT v_id, v_clinic::text || '/' || v_id::text;
END
$$;

-- 7. Upload, step 2: the server stored the bytes; make the document available.
--    Only the uploader, within an hour, for a row still UPLOADING.
CREATE FUNCTION app.complete_patient_document_upload(p_document_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  d public.patient_documents%ROWTYPE;
BEGIN
  PERFORM app.require_document_staff();
  SELECT * INTO d FROM public.patient_documents
   WHERE id = p_document_id AND "clinicId" = app.current_clinic_id() AND "uploadedByUserId" = app.current_user_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient document: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF d.status <> 'UPLOADING' OR d."createdAt" < pg_catalog.now() - interval '1 hour' THEN
    RAISE EXCEPTION 'patient document: INVALID_TRANSITION' USING ERRCODE = '55000';
  END IF;
  UPDATE public.patient_documents SET status = 'AVAILABLE', "uploadedAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now() WHERE id = d.id;
  -- A result file arriving makes a pending lab report available.
  IF d."labReportId" IS NOT NULL THEN
    UPDATE public.lab_reports SET status = 'AVAILABLE', "updatedAt" = pg_catalog.now() WHERE id = d."labReportId" AND status = 'PENDING';
  END IF;
  PERFORM app.log_event('document.uploaded', 'SUCCESS', 'patient_document', d.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('patientId', d."patientId", 'category', d.category, 'clinical', app.document_is_clinical(d.category),
                                  'mimeType', d."mimeType", 'sizeBytes', d."sizeBytes", 'labReportId', d."labReportId"));
  RETURN d.id;
END
$$;

-- 8. Upload failed after registration (storage error, or the server rejected the
--    bytes): the row is kept as FAILED (never listed) for the orphan sweep.
CREATE FUNCTION app.fail_patient_document_upload(p_document_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  d public.patient_documents%ROWTYPE;
  v_reason text := CASE WHEN p_reason ~ '^[a-z_]{1,40}$' THEN p_reason ELSE 'unspecified' END;
BEGIN
  PERFORM app.require_document_staff();
  SELECT * INTO d FROM public.patient_documents
   WHERE id = p_document_id AND "clinicId" = app.current_clinic_id() AND "uploadedByUserId" = app.current_user_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient document: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF d.status <> 'UPLOADING' THEN
    RETURN; -- already completed or failed: idempotent
  END IF;
  UPDATE public.patient_documents SET status = 'FAILED', "failedAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now() WHERE id = d.id;
  PERFORM app.log_event('document.upload_failed', 'FAILURE', 'patient_document', d.id::text, v_reason, NULL, NULL,
    pg_catalog.jsonb_build_object('patientId', d."patientId", 'category', d.category));
END
$$;

-- 9. Archive (never delete). Clinical: administrators (lab.manage /
--    medical_record.manage) within their branch scope, or the doctor who
--    uploaded it within 24 hours. Administrative: patient_document.manage
--    within branch scope. The free-text note stays on the row; the audit event
--    records only the reason code.
CREATE FUNCTION app.archive_patient_document(p_document_id uuid, p_reason "DocumentArchiveReason", p_note text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  d public.patient_documents%ROWTYPE;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_allowed boolean;
BEGIN
  PERFORM app.require_document_staff();
  SELECT * INTO d FROM public.patient_documents WHERE id = p_document_id AND "clinicId" = app.current_clinic_id() FOR UPDATE;
  IF NOT FOUND OR d.status NOT IN ('AVAILABLE', 'ARCHIVED') THEN
    RAISE EXCEPTION 'patient document: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF app.document_is_clinical(d.category) THEN
    v_allowed := (app.staff_can(ARRAY['lab.manage', 'medical_record.manage']) AND app.branch_visible(d."branchId"))
              OR (d."uploadedByUserId" = app.current_user_id() AND app.current_doctor_id() IS NOT NULL
                  AND d."uploadedAt" > pg_catalog.now() - interval '24 hours' AND app.clinical_record_visible(d."patientId", d."branchId"));
  ELSE
    v_allowed := app.staff_can(ARRAY['patient_document.manage']) AND app.branch_visible(d."branchId");
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'patient document: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF d.status = 'ARCHIVED' THEN
    RETURN d.id; -- idempotent
  END IF;
  IF p_reason IS NULL OR (v_note IS NOT NULL AND pg_catalog.char_length(v_note) > 500) THEN
    RAISE EXCEPTION 'patient document: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  UPDATE public.patient_documents
     SET status = 'ARCHIVED', "archivedAt" = pg_catalog.now(), "archivedByUserId" = app.current_user_id(),
         "archiveReason" = p_reason, "archiveNote" = v_note, "updatedAt" = pg_catalog.now()
   WHERE id = d.id;
  PERFORM app.log_event('document.archived', 'SUCCESS', 'patient_document', d.id::text, p_reason::text, NULL, NULL,
    pg_catalog.jsonb_build_object('patientId', d."patientId", 'category', d.category));
  RETURN d.id;
END
$$;

-- 10. Lab reports.
CREATE FUNCTION app.create_lab_report(
  p_patient_id uuid, p_test_type text, p_title text, p_consultation_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_type   text := pg_catalog.btrim(coalesce(p_test_type, ''));
  v_title  text := pg_catalog.btrim(coalesce(p_title, ''));
  v_doctor uuid;
BEGIN
  IF app.current_user_id() IS NULL OR v_clinic IS NULL OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['lab_report.upload']) THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF p_patient_id IS NULL OR NOT app.document_patient_in_scope(p_patient_id) THEN
    RAISE EXCEPTION 'lab report: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.char_length(v_type) NOT BETWEEN 1 AND 60 OR pg_catalog.char_length(v_title) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'lab report: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF p_consultation_id IS NOT NULL THEN
    SELECT a."doctorId" INTO v_doctor FROM public.consultations c JOIN public.appointments a ON a.id = c."appointmentId"
     WHERE c.id = p_consultation_id AND c."clinicId" = v_clinic AND a."patientId" = p_patient_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lab report: INVALID_LINK' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_doctor := coalesce(v_doctor, app.current_doctor_id());
  PERFORM app.document_rate_limit();
  INSERT INTO public.lab_reports (id, "clinicId", "branchId", "patientId", "consultationId", "orderedByDoctorId", "testType", title, "createdByUserId")
  VALUES (v_id, v_clinic, app.document_branch(p_patient_id, p_branch_id), p_patient_id, p_consultation_id, v_doctor, v_type, v_title, app.current_user_id());
  PERFORM app.log_event('lab_report.created', 'SUCCESS', 'lab_report', v_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('patientId', p_patient_id, 'consultationLinked', p_consultation_id IS NOT NULL));
  RETURN v_id;
END
$$;

-- Values: an array (at most 100) of {parameter, value, unit, range, flag}; strings
-- up to 120 characters; flag one of low/high/normal/abnormal or null. Allowed for
-- clinical readers of the report holding lab_result.update or lab.manage. A
-- reviewed report goes back to AVAILABLE (re-review needed); a shared one is locked.
CREATE FUNCTION app.set_lab_report_values(p_report_id uuid, p_values jsonb, p_result_date date DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  r public.lab_reports%ROWTYPE;
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_item jsonb;
BEGIN
  IF app.current_user_id() IS NULL OR NOT app.is_staff_member() THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.lab_reports WHERE id = p_report_id AND "clinicId" = app.current_clinic_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.clinical_record_visible(r."patientId", r."branchId") THEN
    RAISE EXCEPTION 'lab report: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.staff_can(ARRAY['lab_result.update', 'lab.manage']) THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF r."sharedWithPatientAt" IS NOT NULL THEN
    RAISE EXCEPTION 'lab report: SHARED_LOCKED' USING ERRCODE = '55000';
  END IF;
  IF p_values IS NULL OR pg_catalog.jsonb_typeof(p_values) <> 'array' OR pg_catalog.jsonb_array_length(p_values) > 100
     OR pg_catalog.pg_column_size(p_values) > 16384
     OR (v_notes IS NOT NULL AND pg_catalog.char_length(v_notes) > 4000)
     OR (p_result_date IS NOT NULL AND (p_result_date > (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date OR p_result_date < DATE '2000-01-01')) THEN
    RAISE EXCEPTION 'lab report: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT pg_catalog.jsonb_array_elements(p_values) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_item) k WHERE k NOT IN ('parameter', 'value', 'unit', 'range', 'flag'))
       OR pg_catalog.jsonb_typeof(v_item -> 'parameter') IS DISTINCT FROM 'string'
       OR pg_catalog.char_length(v_item ->> 'parameter') NOT BETWEEN 1 AND 120
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(v_item) e
                  WHERE e.key <> 'flag' AND (pg_catalog.jsonb_typeof(e.value) NOT IN ('string', 'null') OR pg_catalog.char_length(e.value #>> '{}') > 120))
       OR (v_item ? 'flag' AND v_item -> 'flag' <> 'null'::jsonb AND (v_item ->> 'flag') NOT IN ('low', 'high', 'normal', 'abnormal')) THEN
      RAISE EXCEPTION 'lab report: INVALID_INPUT' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  UPDATE public.lab_reports
     SET "values" = p_values, "resultDate" = coalesce(p_result_date, "resultDate"), notes = v_notes,
         status = 'AVAILABLE', "reviewedAt" = NULL, "reviewedByUserId" = NULL, "updatedAt" = pg_catalog.now()
   WHERE id = r.id;
  PERFORM app.log_event('lab_report.values_updated', 'SUCCESS', 'lab_report', r.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('patientId', r."patientId", 'valueCount', pg_catalog.jsonb_array_length(p_values), 'reviewCleared', r.status = 'REVIEWED'));
  RETURN r.id;
END
$$;

-- The assigned doctor (the ordering doctor when one is recorded) reviews an AVAILABLE report.
CREATE FUNCTION app.lab_report_doctor_may_sign(r public.lab_reports) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT app.current_doctor_id() IS NOT NULL
     AND app.staff_can(ARRAY['patient.medical_record.view'])
     AND (r."orderedByDoctorId" IS NULL OR r."orderedByDoctorId" = app.current_doctor_id())
     AND EXISTS (SELECT 1 FROM public.appointments a
                 WHERE a."clinicId" = r."clinicId" AND a."patientId" = r."patientId" AND a."doctorId" = app.current_doctor_id())
$$;
REVOKE ALL ON FUNCTION app.lab_report_doctor_may_sign(public.lab_reports) FROM PUBLIC;

CREATE FUNCTION app.review_lab_report(p_report_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  r public.lab_reports%ROWTYPE;
BEGIN
  IF app.current_user_id() IS NULL OR NOT app.is_staff_member() THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.lab_reports WHERE id = p_report_id AND "clinicId" = app.current_clinic_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.clinical_record_visible(r."patientId", r."branchId") THEN
    RAISE EXCEPTION 'lab report: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT app.lab_report_doctor_may_sign(r) THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'REVIEWED' THEN
    RETURN r.id; -- idempotent
  END IF;
  IF r.status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'lab report: INVALID_TRANSITION' USING ERRCODE = '55000';
  END IF;
  UPDATE public.lab_reports SET status = 'REVIEWED', "reviewedAt" = pg_catalog.now(), "reviewedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now()
   WHERE id = r.id;
  PERFORM app.log_event('lab_report.reviewed', 'SUCCESS', 'lab_report', r.id::text, NULL, NULL, NULL, pg_catalog.jsonb_build_object('patientId', r."patientId"));
  RETURN r.id;
END
$$;

-- Share with / withdraw from the patient: administrators (lab.manage /
-- medical_record.manage, branch scope) or the doctor who may sign it. Only reviewed reports.
CREATE FUNCTION app.set_lab_report_shared(p_report_id uuid, p_shared boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  r public.lab_reports%ROWTYPE;
BEGIN
  IF app.current_user_id() IS NULL OR NOT app.is_staff_member() OR p_shared IS NULL THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.lab_reports WHERE id = p_report_id AND "clinicId" = app.current_clinic_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.clinical_record_visible(r."patientId", r."branchId") THEN
    RAISE EXCEPTION 'lab report: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((app.staff_can(ARRAY['lab.manage', 'medical_record.manage']) AND app.branch_visible(r."branchId")) OR app.lab_report_doctor_may_sign(r)) THEN
    RAISE EXCEPTION 'lab report: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF p_shared AND r.status <> 'REVIEWED' THEN
    RAISE EXCEPTION 'lab report: NOT_REVIEWED' USING ERRCODE = '55000';
  END IF;
  IF p_shared = (r."sharedWithPatientAt" IS NOT NULL) THEN
    RETURN r.id; -- idempotent
  END IF;
  UPDATE public.lab_reports
     SET "sharedWithPatientAt" = CASE WHEN p_shared THEN pg_catalog.now() END,
         "sharedByUserId" = CASE WHEN p_shared THEN app.current_user_id() END,
         "updatedAt" = pg_catalog.now()
   WHERE id = r.id;
  PERFORM app.log_event(CASE WHEN p_shared THEN 'lab_report.shared' ELSE 'lab_report.unshared' END, 'SUCCESS', 'lab_report', r.id::text,
    NULL, NULL, NULL, pg_catalog.jsonb_build_object('patientId', r."patientId"));
  RETURN r.id;
END
$$;

-- 11. Execute rights: the runtime role only, for the entry points.
REVOKE ALL ON FUNCTION
  app.begin_patient_document_upload(uuid, "DocumentCategory", text, text, text, integer, text, uuid, uuid, uuid),
  app.complete_patient_document_upload(uuid), app.fail_patient_document_upload(uuid, text),
  app.archive_patient_document(uuid, "DocumentArchiveReason", text),
  app.create_lab_report(uuid, text, text, uuid, uuid), app.set_lab_report_values(uuid, jsonb, date, text),
  app.review_lab_report(uuid), app.set_lab_report_shared(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.begin_patient_document_upload(uuid, "DocumentCategory", text, text, text, integer, text, uuid, uuid, uuid),
  app.complete_patient_document_upload(uuid), app.fail_patient_document_upload(uuid, text),
  app.archive_patient_document(uuid, "DocumentArchiveReason", text),
  app.create_lab_report(uuid, text, text, uuid, uuid), app.set_lab_report_values(uuid, jsonb, date, text),
  app.review_lab_report(uuid), app.set_lab_report_shared(uuid, boolean) TO sehat_app;

-- 12. Row-level audit (ids + changed column names only; never titles, filenames or values).
CREATE TRIGGER audit_lab_reports AFTER INSERT OR UPDATE OR DELETE ON lab_reports
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_patient_documents AFTER INSERT OR UPDATE OR DELETE ON patient_documents
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- 13. Permissions (agreed matrix). New keys use the seed's deterministic ids
--     (demoId('permission:<key>')) and the names in src/data/permission-catalog.ts;
--     an existing row with different values aborts the migration. Grants are
--     added with ON CONFLICT DO NOTHING; postconditions check the exact holders.
DO $$
DECLARE
  k record;
  r record;
  c_new constant jsonb := '[
    {"id": "fbd9eff2-ec17-5359-9bc9-cbc28bf25511", "key": "patient_document.upload", "name": "Upload patient documents", "module": "documents",
     "description": "Upload administrative patient documents such as ID proof, insurance and consent forms."},
    {"id": "6bf7b89a-ef34-5736-a137-14b3e79c9f02", "key": "patient_document.view", "name": "View patient documents", "module": "documents",
     "description": "View administrative patient documents."},
    {"id": "d774ad3e-e2a4-5558-a9db-b5b16c65a32c", "key": "patient_document.manage", "name": "Manage patient documents", "module": "documents",
     "description": "Archive administrative patient documents."}
  ]';
  -- key -> roles that must hold it after this migration
  c_grants constant jsonb := '{
    "patient_document.upload": ["ADMINISTRATOR", "CLINIC_MANAGER", "RECEPTIONIST"],
    "patient_document.view":   ["ADMINISTRATOR", "CLINIC_MANAGER", "RECEPTIONIST"],
    "patient_document.manage": ["ADMINISTRATOR", "CLINIC_MANAGER"],
    "lab_report.upload":       ["ADMINISTRATOR", "RECEPTIONIST", "DOCTOR", "NURSE"],
    "lab_result.update":       ["DOCTOR", "NURSE"]
  }';
BEGIN
  FOR k IN SELECT * FROM jsonb_to_recordset(c_new) AS x(id uuid, key text, name text, module text, description text) LOOP
    SELECT id, key, name, module, description INTO r FROM public.permissions WHERE key = k.key;
    IF FOUND THEN
      IF r.id <> k.id OR r.name IS DISTINCT FROM k.name OR r.module IS DISTINCT FROM k.module OR r.description IS DISTINCT FROM k.description THEN
        RAISE EXCEPTION 'permission % already exists with unexpected values; refusing to continue', k.key;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.permissions WHERE id = k.id) THEN
        RAISE EXCEPTION 'permission id % is already used by another permission; expected it to be free for %', k.id, k.key;
      END IF;
      INSERT INTO public.permissions (id, key, name, module, description) VALUES (k.id, k.key, k.name, k.module, k.description);
    END IF;
  END LOOP;

  -- Existing keys this migration grants must already exist (seeded from the catalogue).
  IF (SELECT pg_catalog.count(*) FROM public.permissions WHERE key IN ('lab_report.upload', 'lab_result.update')) <> 2 THEN
    RAISE EXCEPTION 'permissions lab_report.upload / lab_result.update are missing; refusing to continue';
  END IF;
  -- On an unseeded database (no roles) there is nothing to grant; the seed adds grants from the catalogue.
  IF EXISTS (SELECT 1 FROM public.roles) AND (SELECT pg_catalog.count(*) FROM public.roles
       WHERE key IN ('ADMINISTRATOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DOCTOR', 'NURSE')) <> 5 THEN
    RAISE EXCEPTION 'roles exist but some of ADMINISTRATOR, CLINIC_MANAGER, RECEPTIONIST, DOCTOR, NURSE are missing; refusing to continue';
  END IF;

  INSERT INTO public.role_permissions ("roleId", "permissionId")
  SELECT ro.id, p.id
    FROM jsonb_each(c_grants) g
    CROSS JOIN LATERAL jsonb_array_elements_text(g.value) AS rk(role_key)
    JOIN public.permissions p ON p.key = g.key
    JOIN public.roles ro ON ro.key::text = rk.role_key
  ON CONFLICT DO NOTHING;

  -- Postcondition: on a seeded database, each key is held by exactly the agreed roles.
  IF EXISTS (SELECT 1 FROM public.roles) THEN
    FOR k IN SELECT g.key, (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(g.value) x) AS want FROM jsonb_each(c_grants) g LOOP
      IF (SELECT array_agg(ro.key::text ORDER BY ro.key::text) FROM public.role_permissions rp
            JOIN public.roles ro ON ro.id = rp."roleId" JOIN public.permissions p ON p.id = rp."permissionId" WHERE p.key = k.key)
         IS DISTINCT FROM k.want THEN
        RAISE EXCEPTION 'permission % is not held by exactly %; refusing to continue', k.key, k.want;
      END IF;
    END LOOP;
  END IF;
END
$$;

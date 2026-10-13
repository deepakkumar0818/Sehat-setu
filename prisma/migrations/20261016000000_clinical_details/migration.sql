-- Clinical details for the consultation workspace, and "assigned doctor only"
-- authoring of clinical records.
--
-- 1. Additive columns. Every new column is nullable or has a default, so
--    existing rows are untouched. Nothing is dropped or rewritten.
-- 2. Tighter write policies. Creating or editing a consultation, prescription
--    or prescription item now also requires the caller to be the doctor the
--    appointment is assigned to (app.current_doctor_id()). Administrators keep
--    READ access (medical_record.view / prescription.view); read policies are
--    unchanged. This only removes write access; it grants nothing new.
--
-- The audit trigger (app.audit_row_change) records only the NAMES of changed
-- columns, so none of these clinical values reach audit_events.

ALTER TABLE consultations
  ADD COLUMN "symptoms" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "history" text,
  ADD COLUMN "allergiesNoted" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "vitals" jsonb,
  ADD COLUMN "examination" text,
  ADD COLUMN "treatmentPlan" text,
  ADD COLUMN "labTestsOrdered" text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT consultations_vitals_object CHECK (vitals IS NULL OR (jsonb_typeof(vitals) = 'object' AND pg_column_size(vitals) <= 1024));

ALTER TABLE prescription_items ADD COLUMN "route" text;

-- Consultations: writes only by the appointment's assigned doctor.
DROP POLICY consultations_insert ON consultations;
DROP POLICY consultations_update ON consultations;
CREATE POLICY consultations_insert ON consultations FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId" AND a."doctorId" = (SELECT app.current_doctor_id()))
  AND (SELECT app.staff_can(ARRAY['medical_notes.create', 'medical_record.manage', 'patient.medical_record.update']))
);
CREATE POLICY consultations_update ON consultations FOR UPDATE TO sehat_app
  USING (
    "clinicId" = (SELECT app.current_clinic_id())
    AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId" AND a."doctorId" = (SELECT app.current_doctor_id()))
    AND (SELECT app.staff_can(ARRAY['medical_notes.update', 'medical_record.manage', 'patient.medical_record.update']))
  )
  WITH CHECK (
    "clinicId" = (SELECT app.current_clinic_id())
    AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId" AND a."doctorId" = (SELECT app.current_doctor_id()))
  );

-- Prescriptions and their items: writes only by the consultation's assigned doctor.
DROP POLICY prescriptions_insert ON prescriptions;
DROP POLICY prescriptions_update ON prescriptions;
CREATE POLICY prescriptions_insert ON prescriptions FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (
    SELECT 1 FROM consultations c JOIN appointments a ON a.id = c."appointmentId"
    WHERE c.id = prescriptions."consultationId" AND a."doctorId" = (SELECT app.current_doctor_id()))
  AND (SELECT app.staff_can(ARRAY['prescription.create', 'prescription.manage']))
);
CREATE POLICY prescriptions_update ON prescriptions FOR UPDATE TO sehat_app
  USING (
    "clinicId" = (SELECT app.current_clinic_id())
    AND EXISTS (
      SELECT 1 FROM consultations c JOIN appointments a ON a.id = c."appointmentId"
      WHERE c.id = prescriptions."consultationId" AND a."doctorId" = (SELECT app.current_doctor_id()))
    AND (SELECT app.staff_can(ARRAY['prescription.update', 'prescription.manage']))
  )
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

DROP POLICY prescription_items_insert ON prescription_items;
DROP POLICY prescription_items_update ON prescription_items;
CREATE POLICY prescription_items_insert ON prescription_items FOR INSERT TO sehat_app WITH CHECK (
  EXISTS (
    SELECT 1 FROM prescriptions p JOIN consultations c ON c.id = p."consultationId" JOIN appointments a ON a.id = c."appointmentId"
    WHERE p.id = prescription_items."prescriptionId" AND a."doctorId" = (SELECT app.current_doctor_id()))
  AND (SELECT app.staff_can(ARRAY['prescription.create', 'prescription.manage']))
);
CREATE POLICY prescription_items_update ON prescription_items FOR UPDATE TO sehat_app
  USING (
    EXISTS (
      SELECT 1 FROM prescriptions p JOIN consultations c ON c.id = p."consultationId" JOIN appointments a ON a.id = c."appointmentId"
      WHERE p.id = prescription_items."prescriptionId" AND a."doctorId" = (SELECT app.current_doctor_id()))
    AND (SELECT app.staff_can(ARRAY['prescription.update', 'prescription.manage']))
  )
  WITH CHECK (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId"));

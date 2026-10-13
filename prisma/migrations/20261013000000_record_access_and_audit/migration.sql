-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" UUID,
    "actorAuthId" TEXT,
    "actorLabel" TEXT,
    "clinicId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_clinicId_occurredAt_idx" ON "audit_events"("clinicId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_occurredAt_idx" ON "audit_events"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_action_occurredAt_idx" ON "audit_events"("action", "occurredAt");

-- ===========================================================================
-- Record-level access control + audit trail (hand-written; see docs/security.md)
--
-- The previous migration trusted the app's tenant settings (app.clinic_id /
-- app.branch_id) on their own. Policies now also VERIFY them against the
-- database: the user in app.user_id must hold an active membership in the
-- clinic, permissions come from roles -> role_permissions, branch-restricted
-- memberships only count when the request is scoped to that branch, doctors
-- with only own_* permissions see their own appointments/patients, and
-- patients see only the patient records linked to their own user.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Verification helpers (SECURITY DEFINER: they read membership/role tables
--    without recursing through those tables' own policies). All STABLE and
--    pinned to an empty search_path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_actor_label() RETURNS text
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT nullif(current_setting('app.actor_label', true), '') $$;

-- The request's user is ACTIVE and holds any ACTIVE membership in the ACTIVE current clinic.
CREATE OR REPLACE FUNCTION app.is_clinic_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status = 'ACTIVE'
  )
$$;

-- An active non-PATIENT membership in the current clinic whose branch
-- restriction (if any) matches the request's branch scope.
CREATE OR REPLACE FUNCTION app.is_staff_member() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.roles r ON r.id = m."roleId"
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status = 'ACTIVE'
      AND r.key <> 'PATIENT'
      AND (m."branchId" IS NULL OR m."branchId" = app.current_branch_id())
  )
$$;

-- Does the request's user hold ANY of these permission keys through a staff
-- role in the current clinic (respecting branch restrictions)? PATIENT-role
-- permissions never count here — they only unlock the user's own records.
CREATE OR REPLACE FUNCTION app.staff_can(keys text[]) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_memberships m
    JOIN public.roles r ON r.id = m."roleId"
    JOIN public.role_permissions rp ON rp."roleId" = r.id
    JOIN public.permissions p ON p.id = rp."permissionId"
    JOIN public.clinics c ON c.id = m."clinicId"
    JOIN public.users u ON u.id = m."userId"
    WHERE m."userId" = app.current_user_id()
      AND m."clinicId" = app.current_clinic_id()
      AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status = 'ACTIVE'
      AND r.key <> 'PATIENT'
      AND (m."branchId" IS NULL OR m."branchId" = app.current_branch_id())
      AND p.key = ANY (keys)
  )
$$;

-- The request user's doctor profile in the current clinic (NULL if none).
CREATE OR REPLACE FUNCTION app.current_doctor_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT d.id FROM public.doctor_profiles d
  WHERE d."userId" = app.current_user_id() AND d."clinicId" = app.current_clinic_id() AND d.status = 'ACTIVE'
  LIMIT 1
$$;

-- Patient records in the current clinic linked to the request's user, only if
-- that user holds an ACTIVE PATIENT membership there. Empty array otherwise.
CREATE OR REPLACE FUNCTION app.current_patient_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT coalesce(array_agg(p.id), '{}')
  FROM public.patients p
  WHERE p."userId" = app.current_user_id()
    AND p."clinicId" = app.current_clinic_id()
    AND EXISTS (
      SELECT 1
      FROM public.clinic_memberships m
      JOIN public.roles r ON r.id = m."roleId"
      JOIN public.clinics c ON c.id = m."clinicId"
      JOIN public.users u ON u.id = m."userId"
      WHERE m."userId" = p."userId" AND m."clinicId" = p."clinicId"
        AND r.key = 'PATIENT' AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND u.status = 'ACTIVE'
    )
$$;

REVOKE ALL ON FUNCTION app.current_actor_label(), app.is_clinic_member(), app.is_staff_member(),
  app.staff_can(text[]), app.current_doctor_id(), app.current_patient_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor_label(), app.is_clinic_member(), app.is_staff_member(),
  app.staff_can(text[]), app.current_doctor_id(), app.current_patient_ids() TO sehat_app;

-- ---------------------------------------------------------------------------
-- 2. Replace the tenant policies from 20261012000100 with verified,
--    permission-aware, record-level policies. (SELECT wrappers let PostgreSQL
--    evaluate each helper once per statement instead of once per row.)
-- ---------------------------------------------------------------------------
DROP POLICY users_read ON users;
DROP POLICY memberships_read ON clinic_memberships;
DROP POLICY memberships_write ON clinic_memberships;
DROP POLICY memberships_update ON clinic_memberships;
DROP POLICY clinics_read ON clinics;
DROP POLICY clinics_update ON clinics;
DROP POLICY branches_tenant ON branches;
DROP POLICY departments_tenant ON departments;
DROP POLICY doctor_profiles_tenant ON doctor_profiles;
DROP POLICY doctor_branches_tenant ON doctor_branches;
DROP POLICY patients_tenant ON patients;
DROP POLICY appointments_tenant ON appointments;
DROP POLICY invoices_tenant ON invoices;
DROP POLICY consultations_tenant ON consultations;
DROP POLICY prescriptions_tenant ON prescriptions;
DROP POLICY prescription_items_tenant ON prescription_items;
DROP POLICY invoice_line_items_tenant ON invoice_line_items;
DROP POLICY payments_tenant ON payments;

-- Identity -------------------------------------------------------------------
CREATE POLICY users_read ON users FOR SELECT TO sehat_app USING (
  "authProviderId" = (SELECT app.current_auth_user_id())
  OR id = (SELECT app.current_user_id())
  -- staff see the people in their clinic
  OR ((SELECT app.is_staff_member()) AND EXISTS (
        SELECT 1 FROM clinic_memberships m WHERE m."userId" = users.id AND m."clinicId" = (SELECT app.current_clinic_id())))
  -- patients see their clinic's doctors (names on their own appointments)
  OR ((SELECT app.is_clinic_member()) AND EXISTS (
        SELECT 1 FROM doctor_profiles d WHERE d."userId" = users.id AND d."clinicId" = (SELECT app.current_clinic_id())))
);

CREATE POLICY memberships_read ON clinic_memberships FOR SELECT TO sehat_app USING (
  "userId" = (SELECT app.current_user_id())
  OR ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_staff_member()))
);
CREATE POLICY memberships_insert ON clinic_memberships FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (SELECT app.staff_can(ARRAY['role.manage', 'user.create', 'staff.manage']))
);
CREATE POLICY memberships_update ON clinic_memberships FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['role.manage', 'user.update', 'user.disable', 'staff.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['role.manage', 'user.update', 'user.disable', 'staff.manage'])));

-- Clinic structure -----------------------------------------------------------
CREATE POLICY clinics_read ON clinics FOR SELECT TO sehat_app USING (
  (id = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member()))
  OR EXISTS (SELECT 1 FROM clinic_memberships m WHERE m."clinicId" = clinics.id AND m."userId" = (SELECT app.current_user_id()))
);
CREATE POLICY clinics_update ON clinics FOR UPDATE TO sehat_app
  USING (id = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['clinic.update', 'clinic.settings.manage'])))
  WITH CHECK (id = (SELECT app.current_clinic_id()));

CREATE POLICY branches_read ON branches FOR SELECT TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member()));
CREATE POLICY branches_insert ON branches FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['branch.create'])));
CREATE POLICY branches_update ON branches FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['branch.update'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE POLICY departments_read ON departments FOR SELECT TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member()));
CREATE POLICY departments_insert ON departments FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['clinic.settings.manage', 'branch.update'])));
CREATE POLICY departments_update ON departments FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['clinic.settings.manage', 'branch.update'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE POLICY doctor_profiles_read ON doctor_profiles FOR SELECT TO sehat_app USING (
  "userId" = (SELECT app.current_user_id())
  OR ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member()))
);
CREATE POLICY doctor_profiles_insert ON doctor_profiles FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['doctor.manage'])));
CREATE POLICY doctor_profiles_update ON doctor_profiles FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['doctor.manage', 'profile.update'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE POLICY doctor_branches_read ON doctor_branches FOR SELECT TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.is_clinic_member()));
CREATE POLICY doctor_branches_insert ON doctor_branches FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['doctor.manage'])));
CREATE POLICY doctor_branches_update ON doctor_branches FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['doctor.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

-- Patients -------------------------------------------------------------------
CREATE POLICY patients_read ON patients FOR SELECT TO sehat_app USING (
  -- a patient's own linked records (across clinics; needed to resolve the portal identity)
  "userId" = (SELECT app.current_user_id())
  OR (
    "clinicId" = (SELECT app.current_clinic_id())
    AND (
      (SELECT app.staff_can(ARRAY['patient.view', 'patient.basic_info.view']))
      -- doctors with only assigned_patients.view: patients they have an appointment with
      OR ((SELECT app.staff_can(ARRAY['assigned_patients.view'])) AND EXISTS (
            SELECT 1 FROM appointments a WHERE a."patientId" = patients.id AND a."doctorId" = (SELECT app.current_doctor_id())))
    )
  )
);
CREATE POLICY patients_insert ON patients FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['patient.create'])));
CREATE POLICY patients_update ON patients FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['patient.update', 'patient.update_basic_info'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

-- Appointments ---------------------------------------------------------------
CREATE POLICY appointments_read ON appointments FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND app.branch_visible("branchId")
  AND (
    (SELECT app.staff_can(ARRAY['appointment.view', 'checkin.manage']))
    OR ((SELECT app.staff_can(ARRAY['own_appointments.view'])) AND "doctorId" = (SELECT app.current_doctor_id()))
    OR "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
  )
);
CREATE POLICY appointments_insert ON appointments FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['appointment.create']))
);
CREATE POLICY appointments_update ON appointments FOR UPDATE TO sehat_app
  USING (
    "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
    AND (
      (SELECT app.staff_can(ARRAY['appointment.update', 'appointment.cancel', 'checkin.manage']))
      OR ((SELECT app.staff_can(ARRAY['own_appointments.manage'])) AND "doctorId" = (SELECT app.current_doctor_id()))
    )
  )
  WITH CHECK (
    "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
    AND (
      (SELECT app.staff_can(ARRAY['appointment.update', 'appointment.cancel', 'checkin.manage']))
      -- a doctor can update their own appointments but not hand them to someone else
      OR ((SELECT app.staff_can(ARRAY['own_appointments.manage'])) AND "doctorId" = (SELECT app.current_doctor_id()))
    )
  );

-- Consultations: the appointment must be visible AND the caller needs clinical
-- access (front-desk roles with appointment.view do NOT see clinical notes).
CREATE POLICY consultations_read ON consultations FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId")
  AND (
    (SELECT app.staff_can(ARRAY['medical_record.view', 'patient.medical_record.view', 'medical_record.manage']))
    OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId" AND a."patientId" = ANY ((SELECT app.current_patient_ids())::uuid[]))
  )
);
CREATE POLICY consultations_insert ON consultations FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId")
  AND (SELECT app.staff_can(ARRAY['medical_notes.create', 'medical_record.manage', 'patient.medical_record.update']))
);
CREATE POLICY consultations_update ON consultations FOR UPDATE TO sehat_app
  USING (
    "clinicId" = (SELECT app.current_clinic_id())
    AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId")
    AND (SELECT app.staff_can(ARRAY['medical_notes.update', 'medical_record.manage', 'patient.medical_record.update']))
  )
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId"));

-- Prescriptions --------------------------------------------------------------
CREATE POLICY prescriptions_read ON prescriptions FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM consultations c WHERE c.id = prescriptions."consultationId")
  AND (
    (SELECT app.staff_can(ARRAY['prescription.view', 'prescription.manage', 'prescription.create']))
    OR EXISTS (
      SELECT 1 FROM consultations c JOIN appointments a ON a.id = c."appointmentId"
      WHERE c.id = prescriptions."consultationId" AND a."patientId" = ANY ((SELECT app.current_patient_ids())::uuid[]))
  )
);
CREATE POLICY prescriptions_insert ON prescriptions FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM consultations c WHERE c.id = prescriptions."consultationId")
  AND (SELECT app.staff_can(ARRAY['prescription.create', 'prescription.manage']))
);
CREATE POLICY prescriptions_update ON prescriptions FOR UPDATE TO sehat_app
  USING (
    "clinicId" = (SELECT app.current_clinic_id())
    AND EXISTS (SELECT 1 FROM consultations c WHERE c.id = prescriptions."consultationId")
    AND (SELECT app.staff_can(ARRAY['prescription.update', 'prescription.manage']))
  )
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

CREATE POLICY prescription_items_read ON prescription_items FOR SELECT TO sehat_app
  USING (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId"));
CREATE POLICY prescription_items_insert ON prescription_items FOR INSERT TO sehat_app WITH CHECK (
  EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId")
  AND (SELECT app.staff_can(ARRAY['prescription.create', 'prescription.manage']))
);
CREATE POLICY prescription_items_update ON prescription_items FOR UPDATE TO sehat_app
  USING (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId") AND (SELECT app.staff_can(ARRAY['prescription.update', 'prescription.manage'])))
  WITH CHECK (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId"));

-- Billing --------------------------------------------------------------------
CREATE POLICY invoices_read ON invoices FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND app.branch_visible("branchId")
  AND (
    (SELECT app.staff_can(ARRAY['billing.view', 'invoice.view', 'billing.manage']))
    OR "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
  )
);
CREATE POLICY invoices_insert ON invoices FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['invoice.create', 'billing.manage']))
);
CREATE POLICY invoices_update ON invoices FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
         AND (SELECT app.staff_can(ARRAY['invoice.update', 'billing.manage', 'payment.create'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId"));

CREATE POLICY invoice_line_items_read ON invoice_line_items FOR SELECT TO sehat_app
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId"));
CREATE POLICY invoice_line_items_insert ON invoice_line_items FOR INSERT TO sehat_app WITH CHECK (
  EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId")
  AND (SELECT app.staff_can(ARRAY['invoice.create', 'invoice.update', 'billing.manage']))
);
CREATE POLICY invoice_line_items_update ON invoice_line_items FOR UPDATE TO sehat_app
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId") AND (SELECT app.staff_can(ARRAY['invoice.update', 'billing.manage'])))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId"));

CREATE POLICY payments_read ON payments FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments."invoiceId")
);
CREATE POLICY payments_insert ON payments FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments."invoiceId")
  AND (SELECT app.staff_can(ARRAY['payment.create', 'billing.manage']))
);
CREATE POLICY payments_update ON payments FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['billing.manage', 'refund.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()));

-- ---------------------------------------------------------------------------
-- 3. Audit trail: append-only, written only by database code.
-- ---------------------------------------------------------------------------
REVOKE ALL ON audit_events FROM anon, authenticated;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_metadata_small CHECK (metadata IS NULL OR pg_column_size(metadata) <= 4096);

-- Clinic admins can read their clinic's audit trail. The runtime role gets no
-- INSERT/UPDATE/DELETE privilege at all — rows arrive via the functions below.
GRANT SELECT ON audit_events TO sehat_app;
CREATE POLICY audit_events_read ON audit_events FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND (SELECT app.staff_can(ARRAY['clinic.settings.manage', 'role.manage']))
);

-- Immutability: blocks UPDATE/DELETE/TRUNCATE for every role, including postgres.
CREATE OR REPLACE FUNCTION app.audit_events_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS
$$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_events_immutable();

-- Application security events (sign-in results, access denied, provisioning).
-- Actor and clinic come from the transaction's context; the caller can only
-- add a label (e.g. the attempted email of a failed sign-in).
CREATE OR REPLACE FUNCTION app.log_event(
  p_action text, p_outcome text, p_target_type text DEFAULT NULL, p_target_id text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_actor_label text DEFAULT NULL, p_ip text DEFAULT NULL, p_metadata jsonb DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF p_action !~ '^[a-z_]+(\.[a-z_]+)+$' THEN
    RAISE EXCEPTION 'log_event: invalid action';
  END IF;
  INSERT INTO public.audit_events ("actorUserId", "actorAuthId", "actorLabel", "clinicId", action, "targetType", "targetId", outcome, reason, "ipAddress", metadata)
  VALUES (app.current_user_id(), app.current_auth_user_id(), left(coalesce(p_actor_label, app.current_actor_label()), 320),
          app.current_clinic_id(), p_action, left(p_target_type, 64), left(p_target_id, 128),
          p_outcome::public."AuditOutcome", left(p_reason, 128), left(p_ip, 64), p_metadata);
END
$$;
REVOKE ALL ON FUNCTION app.log_event(text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_event(text, text, text, text, text, text, text, jsonb) TO sehat_app;

-- Data-change events. Records WHO changed WHICH row and WHICH columns — never
-- the values, so no clinical content or secrets end up in the audit trail.
-- Membership/role-permission rows also record their (non-sensitive) ids.
CREATE OR REPLACE FUNCTION app.audit_row_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_meta jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
    FROM jsonb_each(v_new) n
    WHERE n.value IS DISTINCT FROM v_old -> n.key AND n.key <> 'updatedAt';
    IF v_changed IS NULL THEN
      RETURN NULL; -- no real change
    END IF;
  END IF;
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'changed', to_jsonb(v_changed),
    'row', CASE WHEN TG_TABLE_NAME IN ('clinic_memberships', 'role_permissions')
                THEN jsonb_strip_nulls(jsonb_build_object('userId', v_row ->> 'userId', 'roleId', v_row ->> 'roleId',
                       'permissionId', v_row ->> 'permissionId', 'branchId', v_row ->> 'branchId', 'status', v_row ->> 'status'))
           END
  ));
  INSERT INTO public.audit_events ("actorUserId", "actorAuthId", "actorLabel", "clinicId", action, "targetType", "targetId", outcome, metadata)
  VALUES (app.current_user_id(), app.current_auth_user_id(),
          coalesce(app.current_actor_label(), CASE WHEN app.current_user_id() IS NULL THEN 'db:' || session_user END),
          coalesce((v_row ->> 'clinicId')::uuid, app.current_clinic_id()),
          TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
          coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'roleId', v_row ->> 'permissionId')),
          'SUCCESS', nullif(v_meta, '{}'::jsonb));
  RETURN NULL;
END
$$;

CREATE TRIGGER audit_patients AFTER INSERT OR UPDATE OR DELETE ON patients FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_appointments AFTER INSERT OR UPDATE OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_consultations AFTER INSERT OR UPDATE OR DELETE ON consultations FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_prescriptions AFTER INSERT OR UPDATE OR DELETE ON prescriptions FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_prescription_items AFTER INSERT OR UPDATE OR DELETE ON prescription_items FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_clinic_memberships AFTER INSERT OR UPDATE OR DELETE ON clinic_memberships FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_role_permissions AFTER INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_roles AFTER UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

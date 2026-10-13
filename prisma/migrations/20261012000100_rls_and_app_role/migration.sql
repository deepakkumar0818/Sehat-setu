-- Sehat Setu — Row-Level Security, runtime role, and Data API lockdown.
--
-- Architecture (see docs/security.md):
--   * Migrations and seeding connect as `postgres` (DIRECT_URL). That role has
--     BYPASSRLS, so it is never used for application requests.
--   * The Next.js server connects as `sehat_app` (DATABASE_URL): NOBYPASSRLS,
--     no DDL rights, no DELETE. Every request runs inside a transaction that
--     first sets its tenant context with set_config(..., is_local => true):
--         app.auth_user_id  Supabase auth user id (verified server-side)
--         app.user_id       public.users.id resolved from it
--         app.clinic_id     the verified active clinic membership
--         app.branch_id     set only for branch-restricted memberships
--     is_local settings are discarded at COMMIT/ROLLBACK, so tenant context
--     can never leak to the next request on a pooled connection.
--   * With no context set, every tenant-owned policy evaluates to false: the
--     default is deny.
--   * Supabase's Data API roles (anon, authenticated) get no access at all;
--     this app reads data only through Prisma on the server.

-- ---------------------------------------------------------------------------
-- 1. Lock out the Supabase Data API roles
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant anon/authenticated full CRUD on every
-- new table in `public`, reachable with the public (browser) API key. Revoke
-- on everything that exists, and stop future Prisma-created objects from
-- inheriting those grants.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Runtime role (password is set out-of-band by prisma/setup-app-role.ts)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sehat_app') THEN
    CREATE ROLE sehat_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
-- Refuse to continue if a pre-existing sehat_app has broader attributes.
-- (Supabase's supautils forbids non-superusers from ALTER ROLE naming the
-- SUPERUSER attribute, so check rather than re-assert.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sehat_app' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'sehat_app exists with privileged attributes; fix it manually before migrating';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sehat_app;

-- ---------------------------------------------------------------------------
-- 3. Tenant-context helpers
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO sehat_app;

CREATE OR REPLACE FUNCTION app.current_clinic_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_branch_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT nullif(current_setting('app.branch_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_auth_user_id() RETURNS text
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT nullif(current_setting('app.auth_user_id', true), '') $$;

-- True when no branch restriction applies, or the row's branch matches it.
CREATE OR REPLACE FUNCTION app.branch_visible(row_branch_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = '' AS
  $$ SELECT app.current_branch_id() IS NULL OR row_branch_id = app.current_branch_id() $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_clinic_id(), app.current_branch_id(), app.current_user_id(),
  app.current_auth_user_id(), app.branch_visible(uuid) TO sehat_app;

-- Links a Supabase Auth user to the INVITED public.users row with the same
-- (verified) email, exactly once. SECURITY DEFINER because the row is not yet
-- visible to sehat_app under RLS. The server only calls this with the id and
-- email from supabase.auth.getUser() after checking the email is confirmed.
CREATE OR REPLACE FUNCTION app.link_auth_user(p_auth_user_id text, p_email text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(p_auth_user_id, '') = '' OR coalesce(p_email, '') = '' THEN
    RETURN NULL;
  END IF;
  -- Must match the identity the server pinned for this transaction.
  IF p_auth_user_id IS DISTINCT FROM app.current_auth_user_id() THEN
    RAISE EXCEPTION 'link_auth_user: auth user does not match transaction context';
  END IF;
  UPDATE public.users
     SET "authProviderId" = p_auth_user_id, status = 'ACTIVE', "updatedAt" = now()
   WHERE lower(email) = lower(p_email)
     AND "authProviderId" IS NULL
     AND status = 'INVITED'
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app.link_auth_user(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.link_auth_user(text, text) TO sehat_app;

-- ---------------------------------------------------------------------------
-- 4. Table privileges for the runtime role (no DELETE: clinical and billing
--    records are never hard-deleted by the application)
-- ---------------------------------------------------------------------------
GRANT SELECT ON specialties, medicines, roles, permissions, role_permissions TO sehat_app;
GRANT SELECT ON users TO sehat_app;
GRANT SELECT, UPDATE ON clinics TO sehat_app;
GRANT SELECT, INSERT, UPDATE ON
  branches, departments, clinic_memberships, doctor_profiles, doctor_branches,
  patients, appointments, consultations, prescriptions, prescription_items,
  invoices, invoice_line_items, payments
TO sehat_app;

-- ---------------------------------------------------------------------------
-- 5. Enable RLS everywhere (including Prisma's bookkeeping table)
-- ---------------------------------------------------------------------------
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Policies (all scoped TO sehat_app; no other role has a policy, so every
--    other non-bypass role sees nothing)
-- ---------------------------------------------------------------------------

-- Global, read-only reference data.
CREATE POLICY specialties_read ON specialties FOR SELECT TO sehat_app USING (true);
CREATE POLICY medicines_read ON medicines FOR SELECT TO sehat_app USING (true);
CREATE POLICY roles_read ON roles FOR SELECT TO sehat_app USING (true);
CREATE POLICY permissions_read ON permissions FOR SELECT TO sehat_app USING (true);
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT TO sehat_app USING (true);

-- Identity: your own user row, plus members of the active clinic.
CREATE POLICY users_read ON users FOR SELECT TO sehat_app USING (
  "authProviderId" = app.current_auth_user_id()
  OR id = app.current_user_id()
  OR EXISTS (
    SELECT 1 FROM clinic_memberships m
    WHERE m."userId" = users.id AND m."clinicId" = app.current_clinic_id()
  )
);

-- Memberships: your own (needed to resolve your clinics before a clinic is
-- chosen), plus every membership of the active clinic.
CREATE POLICY memberships_read ON clinic_memberships FOR SELECT TO sehat_app USING (
  "userId" = app.current_user_id() OR "clinicId" = app.current_clinic_id()
);
CREATE POLICY memberships_write ON clinic_memberships FOR INSERT TO sehat_app
  WITH CHECK ("clinicId" = app.current_clinic_id());
CREATE POLICY memberships_update ON clinic_memberships FOR UPDATE TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());

-- Clinics: the active clinic, plus any clinic you hold a membership in (for
-- the clinic switcher).
CREATE POLICY clinics_read ON clinics FOR SELECT TO sehat_app USING (
  id = app.current_clinic_id()
  OR EXISTS (SELECT 1 FROM clinic_memberships m WHERE m."clinicId" = clinics.id AND m."userId" = app.current_user_id())
);
CREATE POLICY clinics_update ON clinics FOR UPDATE TO sehat_app
  USING (id = app.current_clinic_id()) WITH CHECK (id = app.current_clinic_id());

-- Clinic-scoped tables (visible across all branches of the active clinic).
CREATE POLICY branches_tenant ON branches FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());
CREATE POLICY departments_tenant ON departments FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());
CREATE POLICY doctor_profiles_tenant ON doctor_profiles FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());
CREATE POLICY doctor_branches_tenant ON doctor_branches FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());
-- Patients are clinic-wide: a branch-restricted receptionist still needs to
-- find a patient who registered at another branch of the same clinic.
CREATE POLICY patients_tenant ON patients FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()) WITH CHECK ("clinicId" = app.current_clinic_id());

-- Branch-scoped tables: clinic match AND (no branch restriction OR same branch).
CREATE POLICY appointments_tenant ON appointments FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id() AND app.branch_visible("branchId"))
  WITH CHECK ("clinicId" = app.current_clinic_id() AND app.branch_visible("branchId"));
CREATE POLICY invoices_tenant ON invoices FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id() AND app.branch_visible("branchId"))
  WITH CHECK ("clinicId" = app.current_clinic_id() AND app.branch_visible("branchId"));

-- Records that inherit visibility from their parent. The EXISTS subqueries are
-- themselves subject to the parent's policy, so branch restrictions carry over.
CREATE POLICY consultations_tenant ON consultations FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId"))
  WITH CHECK ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = consultations."appointmentId"));
CREATE POLICY prescriptions_tenant ON prescriptions FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM consultations c WHERE c.id = prescriptions."consultationId"))
  WITH CHECK ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM consultations c WHERE c.id = prescriptions."consultationId"));
CREATE POLICY prescription_items_tenant ON prescription_items FOR ALL TO sehat_app
  USING (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId"))
  WITH CHECK (EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_items."prescriptionId"));
CREATE POLICY invoice_line_items_tenant ON invoice_line_items FOR ALL TO sehat_app
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId"))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items."invoiceId"));
CREATE POLICY payments_tenant ON payments FOR ALL TO sehat_app
  USING ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments."invoiceId"))
  WITH CHECK ("clinicId" = app.current_clinic_id()
         AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments."invoiceId"));

-- Clinic expenses, and audit for clinic setup changes.
-- * expenses: one row per recorded clinic expense, per branch. Amounts are
--   integer paise. Never deleted or edited: a wrong entry is VOIDED (with a
--   reason), so the ledger keeps every recorded amount. Column-level grants
--   leave only the void columns updatable.
-- * Reading needs billing.manage or financial_reports.view; recording and
--   voiding need billing.manage. Clinic + branch isolation as for invoices.
-- * Audit: expenses, branches, departments and the clinic profile now write
--   row-change events (who changed which columns; no values), so the Audit Log
--   shows clinic setup changes.
-- Additive only: no existing table, column, policy or grant is changed.

CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARY', 'UTILITIES', 'EQUIPMENT', 'MEDICINE_PURCHASE', 'LAB_EXPENSE', 'MARKETING', 'MAINTENANCE', 'OTHER');
CREATE TYPE "ExpenseStatus" AS ENUM ('RECORDED', 'VOIDED');

CREATE TABLE "expenses" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"        uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "branchId"        uuid NOT NULL,
  "category"        "ExpenseCategory" NOT NULL,
  "description"     text NOT NULL CHECK (length(btrim("description")) BETWEEN 1 AND 200),
  "amountPaise"     integer NOT NULL CHECK ("amountPaise" BETWEEN 1 AND 2000000000),
  "expenseDate"     date NOT NULL,
  "paidTo"          text CHECK ("paidTo" IS NULL OR length("paidTo") <= 120),
  "reference"       text CHECK ("reference" IS NULL OR length("reference") <= 64),
  "status"          "ExpenseStatus" NOT NULL DEFAULT 'RECORDED',
  "voidReason"      text CHECK ("voidReason" IS NULL OR length("voidReason") <= 300),
  "voidedByUserId"  uuid REFERENCES users(id) ON DELETE RESTRICT,
  "voidedAt"        timestamptz(6),
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt"       timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT expenses_branch_fk FOREIGN KEY ("clinicId", "branchId") REFERENCES branches("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT expenses_clinic_id_key UNIQUE ("clinicId", id),
  CONSTRAINT expenses_void_consistent CHECK (
    ("status" = 'RECORDED' AND "voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidReason" IS NULL)
    OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND length(btrim(coalesce("voidReason", ''))) >= 3)
  )
);
CREATE INDEX expenses_clinic_date_idx ON expenses ("clinicId", "expenseDate" DESC);
CREATE INDEX expenses_branch_date_idx ON expenses ("clinicId", "branchId", "expenseDate" DESC);

-- ---------------------------------------------------------------------------
-- Privileges: no DELETE; only the void columns can change after recording
-- ---------------------------------------------------------------------------
REVOKE ALL ON expenses FROM anon, authenticated;
GRANT SELECT ON expenses TO sehat_app;
GRANT INSERT ("id", "clinicId", "branchId", "category", "description", "amountPaise", "expenseDate", "paidTo", "reference", "createdByUserId", "updatedAt") ON expenses TO sehat_app;
GRANT UPDATE ("status", "voidReason", "voidedByUserId", "voidedAt", "updatedAt") ON expenses TO sehat_app;

-- ---------------------------------------------------------------------------
-- RLS: clinic + branch isolation, billing permissions
-- ---------------------------------------------------------------------------
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_read ON expenses FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['billing.manage', 'financial_reports.view']))
);
CREATE POLICY expenses_insert ON expenses FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND "createdByUserId" = (SELECT app.current_user_id())
  AND "status" = 'RECORDED'
  AND (SELECT app.staff_can(ARRAY['billing.manage']))
);
-- Only RECORDED → VOIDED, by the current user.
CREATE POLICY expenses_void ON expenses FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
         AND "status" = 'RECORDED'
         AND (SELECT app.staff_can(ARRAY['billing.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
              AND "status" = 'VOIDED' AND "voidedByUserId" = (SELECT app.current_user_id()));

-- ---------------------------------------------------------------------------
-- Audit: who changed which row/columns (no values)
-- ---------------------------------------------------------------------------
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_branches AFTER INSERT OR UPDATE OR DELETE ON branches FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_departments AFTER INSERT OR UPDATE OR DELETE ON departments FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_clinics AFTER UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

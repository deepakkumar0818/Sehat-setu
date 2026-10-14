-- Branch-level medicine stock with an append-only movement ledger.
-- * inventory_items: one row per (branch, catalogue medicine, batch). Quantity
--   can't go negative (CHECK) and the runtime role can't write it directly:
--   column-level grants exclude "quantityOnHand".
-- * stock_movements: append-only. Inserting a movement is the ONLY way to
--   change quantity: a trigger locks the item row, validates, applies the
--   delta and records the resulting quantity, all in the same statement.
-- * inventory_reorder_levels: reorder level per (branch, medicine), since
--   low stock is a property of the medicine at a branch, not of one batch.
-- * Clinic Manager gets pharmacy.inventory.view (approved): view-only, and only
--   for the branch their membership is restricted to. No manage permission.
-- Additive only: no existing table, column or policy is changed; one
-- role_permissions row is added, idempotently.

CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'REVERSAL');

CREATE TABLE "inventory_items" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"       uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "branchId"       uuid NOT NULL,
  "medicineId"     uuid NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
  "batchNumber"    text NOT NULL CHECK (length(btrim("batchNumber")) BETWEEN 1 AND 64),
  "expiryDate"     date NOT NULL,
  "quantityOnHand" integer NOT NULL DEFAULT 0 CHECK ("quantityOnHand" >= 0),
  "unitCostPaise"  integer CHECK ("unitCostPaise" IS NULL OR "unitCostPaise" BETWEEN 0 AND 10000000),
  "supplierName"   text CHECK ("supplierName" IS NULL OR length("supplierName") <= 120),
  "createdAt"      timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_branch_fk FOREIGN KEY ("clinicId", "branchId") REFERENCES branches("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT inventory_items_clinic_id_key UNIQUE ("clinicId", id)
);
-- The same batch can't be recorded twice at a branch (batch numbers compared case-insensitively, trimmed).
CREATE UNIQUE INDEX inventory_items_batch_key ON inventory_items ("clinicId", "branchId", "medicineId", lower(btrim("batchNumber")));
CREATE INDEX inventory_items_branch_idx ON inventory_items ("clinicId", "branchId", "medicineId");
CREATE INDEX inventory_items_expiry_idx ON inventory_items ("clinicId", "branchId", "expiryDate") WHERE "quantityOnHand" > 0;

CREATE TABLE "inventory_reorder_levels" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"     uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "branchId"     uuid NOT NULL,
  "medicineId"   uuid NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
  "reorderLevel" integer NOT NULL CHECK ("reorderLevel" BETWEEN 0 AND 1000000),
  "updatedAt"    timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reorder_levels_branch_fk FOREIGN KEY ("clinicId", "branchId") REFERENCES branches("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reorder_levels_key UNIQUE ("clinicId", "branchId", "medicineId")
);

CREATE TABLE "stock_movements" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"           uuid NOT NULL,
  "branchId"           uuid NOT NULL,
  "inventoryItemId"    uuid NOT NULL,
  "type"               "StockMovementType" NOT NULL,
  "quantityDelta"      integer NOT NULL CHECK ("quantityDelta" <> 0 AND abs("quantityDelta") <= 1000000),
  -- Set by the trigger, never by the caller:
  "quantityAfter"      integer NOT NULL DEFAULT 0 CHECK ("quantityAfter" >= 0),
  "actorUserId"        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "occurredAt"         timestamptz(6) NOT NULL DEFAULT now(),
  "reason"             text CHECK ("reason" IS NULL OR length("reason") <= 300),
  -- Supplier invoice / delivery note number for receipts.
  "reference"          text CHECK ("reference" IS NULL OR length("reference") <= 100),
  "reversesMovementId" uuid UNIQUE REFERENCES stock_movements(id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_item_fk FOREIGN KEY ("clinicId", "inventoryItemId") REFERENCES inventory_items("clinicId", id) ON DELETE RESTRICT,
  -- Shape rules per type:
  CONSTRAINT stock_movements_receipt_positive CHECK ("type" <> 'RECEIPT' OR "quantityDelta" > 0),
  CONSTRAINT stock_movements_adjustment_reason CHECK ("type" <> 'ADJUSTMENT' OR length(btrim(coalesce("reason", ''))) >= 3),
  CONSTRAINT stock_movements_reversal_link CHECK (("type" = 'REVERSAL') = ("reversesMovementId" IS NOT NULL))
);
CREATE INDEX stock_movements_item_idx ON stock_movements ("inventoryItemId", "occurredAt");
CREATE INDEX stock_movements_branch_idx ON stock_movements ("clinicId", "branchId", "occurredAt");

-- ---------------------------------------------------------------------------
-- Quantity changes only through a movement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_stock_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_item     public.inventory_items%ROWTYPE;
  v_orig     public.stock_movements%ROWTYPE;
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_new_qty  integer;
BEGIN
  -- Re-check the caller (defence in depth; RLS checks again after this trigger).
  IF app.current_user_id() IS NULL OR NOT app.is_staff_member()
     OR NOT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage']) THEN
    RAISE EXCEPTION 'stock movement: not permitted' USING ERRCODE = '42501';
  END IF;

  -- Serialises concurrent movements on the same item until the transaction ends.
  SELECT * INTO v_item FROM public.inventory_items WHERE id = NEW."inventoryItemId" FOR UPDATE;
  IF NOT FOUND OR v_item."clinicId" <> app.current_clinic_id() OR NOT app.branch_visible(v_item."branchId") THEN
    RAISE EXCEPTION 'stock movement: item not found' USING ERRCODE = '42501';
  END IF;

  IF NEW."type" = 'REVERSAL' THEN
    SELECT * INTO v_orig FROM public.stock_movements WHERE id = NEW."reversesMovementId";
    IF NOT FOUND OR v_orig."inventoryItemId" <> NEW."inventoryItemId" THEN
      RAISE EXCEPTION 'stock movement: nothing to reverse' USING ERRCODE = '22023';
    END IF;
    IF v_orig."type" = 'REVERSAL' THEN
      RAISE EXCEPTION 'stock movement: a reversal cannot be reversed' USING ERRCODE = '22023';
    END IF;
    NEW."quantityDelta" := -v_orig."quantityDelta"; -- exact opposite, whatever the caller sent
  END IF;

  -- Stock can't be added to an expired batch (receipts, positive adjustments,
  -- or reversing a write-off). Removing expired stock is allowed (write-off).
  IF NEW."quantityDelta" > 0 AND v_item."expiryDate" < v_today THEN
    RAISE EXCEPTION 'stock movement: batch is expired' USING ERRCODE = '22023';
  END IF;

  v_new_qty := v_item."quantityOnHand" + NEW."quantityDelta";
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'stock movement: insufficient stock' USING ERRCODE = '23514';
  END IF;

  UPDATE public.inventory_items SET "quantityOnHand" = v_new_qty, "updatedAt" = now() WHERE id = v_item.id;

  -- Server-set fields: the caller can't choose scope, actor, time or the result.
  NEW."clinicId"      := v_item."clinicId";
  NEW."branchId"      := v_item."branchId";
  NEW."quantityAfter" := v_new_qty;
  NEW."actorUserId"   := app.current_user_id();
  NEW."occurredAt"    := now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.apply_stock_movement() FROM PUBLIC;
CREATE TRIGGER stock_movements_apply BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();

-- Append-only, for every role (same pattern as audit_events).
CREATE OR REPLACE FUNCTION app.stock_movements_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS
$$ BEGIN RAISE EXCEPTION 'stock_movements is append-only'; END $$;
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.stock_movements_immutable();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION app.stock_movements_immutable();

-- ---------------------------------------------------------------------------
-- Privileges: no DELETE anywhere; quantity not writable directly
-- ---------------------------------------------------------------------------
REVOKE ALL ON inventory_items, inventory_reorder_levels, stock_movements FROM anon, authenticated;
GRANT SELECT ON inventory_items, inventory_reorder_levels, stock_movements TO sehat_app;
GRANT INSERT ("id", "clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "unitCostPaise", "supplierName", "updatedAt") ON inventory_items TO sehat_app;
GRANT UPDATE ("unitCostPaise", "supplierName", "updatedAt") ON inventory_items TO sehat_app;
GRANT INSERT, UPDATE ON inventory_reorder_levels TO sehat_app;
GRANT INSERT ("id", "clinicId", "branchId", "inventoryItemId", "type", "quantityDelta", "quantityAfter", "actorUserId", "reason", "reference", "reversesMovementId") ON stock_movements TO sehat_app;

-- ---------------------------------------------------------------------------
-- RLS: clinic + branch isolation, inventory permissions
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reorder_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_items_read ON inventory_items FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.view', 'pharmacy.inventory.manage', 'pharmacy.manage']))
);
CREATE POLICY inventory_items_insert ON inventory_items FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND "quantityOnHand" = 0
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage']))
);
CREATE POLICY inventory_items_update ON inventory_items FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
         AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId"));

CREATE POLICY inventory_reorder_levels_read ON inventory_reorder_levels FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.view', 'pharmacy.inventory.manage', 'pharmacy.manage']))
);
CREATE POLICY inventory_reorder_levels_write ON inventory_reorder_levels FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage']))
);
CREATE POLICY inventory_reorder_levels_update ON inventory_reorder_levels FOR UPDATE TO sehat_app
  USING ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
         AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage'])))
  WITH CHECK ("clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId"));

CREATE POLICY stock_movements_read ON stock_movements FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.view', 'pharmacy.inventory.manage', 'pharmacy.manage']))
);
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT TO sehat_app WITH CHECK (
  "clinicId" = (SELECT app.current_clinic_id()) AND app.branch_visible("branchId")
  AND "actorUserId" = (SELECT app.current_user_id())
  AND EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = stock_movements."inventoryItemId")
  AND (SELECT app.staff_can(ARRAY['pharmacy.inventory.manage', 'pharmacy.manage']))
);
-- No UPDATE or DELETE policies (and no grants) on stock_movements.

-- Audit: who changed which row/columns (no values). No patient data lives in these tables.
CREATE TRIGGER audit_inventory_items AFTER INSERT OR UPDATE OR DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_inventory_reorder_levels AFTER INSERT OR UPDATE OR DELETE ON inventory_reorder_levels FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_stock_movements AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Approved permission change: Clinic Manager may VIEW inventory (no manage).
-- Idempotent; inserts nothing on a database that isn't seeded yet (the seed
-- then adds it from src/data/permission-catalog.ts).
-- ---------------------------------------------------------------------------
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'pharmacy.inventory.view'
WHERE r.key = 'CLINIC_MANAGER'
ON CONFLICT DO NOTHING;

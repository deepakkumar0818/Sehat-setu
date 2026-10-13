-- P5a: in-app notifications (approved design).
-- * Rows carry no free text: type + reference id + a small allow-listed data
--   object. Titles/bodies are rendered server-side from fixed templates
--   (src/server/data/notification-templates.ts), so no patient name or clinical
--   detail can be stored.
-- * The runtime role can only READ notifications and record its OWN read
--   receipts. Rows are created exclusively by database triggers/functions in
--   the same transaction as the action; app.add_notification is not executable
--   by sehat_app.
-- * Visibility: same clinic + active staff member, and
--   PERSONAL -> the recipient only; BRANCH -> branch visible + permission;
--   CLINIC -> permission. Patients never see staff notifications.
-- * Retention: 90 days. Older rows are hidden by the application's queries and
--   deleted only by the operator script prisma/purge-notifications.ts (the
--   runtime role has no DELETE privilege). Nothing is scheduled.
-- * No existing table, row, policy or grant is modified.

CREATE TYPE "NotificationScope" AS ENUM ('PERSONAL', 'BRANCH', 'CLINIC');
CREATE TYPE "NotificationType" AS ENUM (
  'APPOINTMENT_BOOKED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_CHECKED_IN',
  'STOCK_LOW', 'STOCK_OUT', 'STAFF_INVITATION_ACCEPTED');

CREATE TABLE "notifications" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"            UUID NOT NULL,
  "scope"               "NotificationScope" NOT NULL,
  "recipientUserId"     UUID,
  "branchId"            UUID,
  "requiredPermissions" TEXT[],
  "type"                "NotificationType" NOT NULL,
  "refId"               UUID,
  "data"                JSONB NOT NULL DEFAULT '{}'::jsonb,
  "actorUserId"         UUID,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_clinicId_branchId_fkey" FOREIGN KEY ("clinicId", "branchId") REFERENCES "branches"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_scope_shape" CHECK (
       ("scope" = 'PERSONAL' AND "recipientUserId" IS NOT NULL AND "branchId" IS NULL AND "requiredPermissions" IS NULL)
    OR ("scope" = 'BRANCH'   AND "recipientUserId" IS NULL AND "branchId" IS NOT NULL AND cardinality("requiredPermissions") > 0)
    OR ("scope" = 'CLINIC'   AND "recipientUserId" IS NULL AND "branchId" IS NULL AND cardinality("requiredPermissions") > 0)),
  CONSTRAINT "notifications_data_small" CHECK (jsonb_typeof("data") = 'object' AND pg_column_size("data") <= 512)
);
CREATE INDEX "notifications_recipientUserId_createdAt_idx" ON "notifications" ("recipientUserId", "createdAt");
CREATE INDEX "notifications_clinicId_branchId_createdAt_idx" ON "notifications" ("clinicId", "branchId", "createdAt");
CREATE INDEX "notifications_createdAt_idx" ON "notifications" ("createdAt"); -- retention purge

CREATE TABLE "notification_reads" (
  "userId"         UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "readAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("userId", "notificationId"),
  CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notification_reads_notificationId_idx" ON "notification_reads" ("notificationId");

-- Privileges: read both; insert own receipts (readAt is server-set). No UPDATE/DELETE.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON notifications, notification_reads TO sehat_app;
GRANT INSERT ("userId", "notificationId") ON notification_reads TO sehat_app;

CREATE POLICY notifications_read ON notifications FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (SELECT app.is_staff_member())
  AND CASE "scope"
        WHEN 'PERSONAL' THEN "recipientUserId" = (SELECT app.current_user_id())
        WHEN 'BRANCH'   THEN app.branch_visible("branchId") AND app.staff_can("requiredPermissions")
        WHEN 'CLINIC'   THEN app.staff_can("requiredPermissions")
      END
);
CREATE POLICY notification_reads_read ON notification_reads FOR SELECT TO sehat_app
  USING ("userId" = (SELECT app.current_user_id()));
-- The EXISTS subquery is itself filtered by notifications_read: you can only
-- mark notifications you are allowed to see.
CREATE POLICY notification_reads_insert ON notification_reads FOR INSERT TO sehat_app WITH CHECK (
  "userId" = (SELECT app.current_user_id())
  AND EXISTS (SELECT 1 FROM notifications n WHERE n.id = "notificationId")
);

-- Internal writer. NOT granted to sehat_app: only the SECURITY DEFINER
-- triggers/functions (owned by the migration role) can call it.
CREATE FUNCTION app.add_notification(
  p_clinic_id uuid, p_scope text, p_recipient_user_id uuid, p_branch_id uuid,
  p_required_permissions text[], p_type text, p_ref_id uuid, p_data jsonb
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  -- In-app actions only: operator/seed writes (no app user) never notify.
  IF app.current_user_id() IS NULL THEN
    RETURN;
  END IF;
  IF p_scope = 'PERSONAL' THEN
    -- Never notify people about their own action; only notify someone who can
    -- currently read it (active, non-patient member of that clinic).
    IF p_recipient_user_id IS NULL OR p_recipient_user_id = app.current_user_id() THEN
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.clinic_memberships m
      JOIN public.roles r ON r.id = m."roleId"
      JOIN public.users u ON u.id = m."userId"
      WHERE m."userId" = p_recipient_user_id AND m."clinicId" = p_clinic_id
        AND m.status = 'ACTIVE' AND r.key <> 'PATIENT' AND u.status <> 'DISABLED') THEN
      RETURN;
    END IF;
  ELSIF (SELECT pg_catalog.count(*) FROM public.permissions p WHERE p.key = ANY (p_required_permissions))
        <> pg_catalog.cardinality(p_required_permissions) THEN
    RAISE EXCEPTION 'add_notification: unknown permission';
  END IF;
  INSERT INTO public.notifications ("clinicId", "scope", "recipientUserId", "branchId", "requiredPermissions", "type", "refId", "data", "actorUserId")
  VALUES (p_clinic_id, p_scope::public."NotificationScope", p_recipient_user_id, p_branch_id, p_required_permissions,
          p_type::public."NotificationType", p_ref_id, coalesce(p_data, '{}'::jsonb), app.current_user_id());
END
$$;
REVOKE ALL ON FUNCTION app.add_notification(uuid, text, uuid, uuid, text[], text, uuid, jsonb) FROM PUBLIC;

-- Appointment events -> the assigned doctor (personal). Data: times and branch only.
CREATE FUNCTION app.notify_appointment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c_closed constant text[] := ARRAY['CANCELLED', 'NO_SHOW', 'COMPLETED'];
  v_doctor uuid;
  v_old_doctor uuid;
  v_data jsonb := pg_catalog.jsonb_build_object('startsAt', NEW."startsAt", 'branchId', NEW."branchId");
BEGIN
  SELECT d."userId" INTO v_doctor FROM public.doctor_profiles d WHERE d.id = NEW."doctorId" AND d."clinicId" = NEW."clinicId";

  IF TG_OP = 'INSERT' THEN
    IF NOT (NEW.status::text = ANY (c_closed)) THEN
      PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_BOOKED', NEW.id, v_data);
    END IF;
  ELSIF NEW."doctorId" IS DISTINCT FROM OLD."doctorId" THEN
    SELECT d."userId" INTO v_old_doctor FROM public.doctor_profiles d WHERE d.id = OLD."doctorId" AND d."clinicId" = OLD."clinicId";
    PERFORM app.add_notification(OLD."clinicId", 'PERSONAL', v_old_doctor, NULL, NULL, 'APPOINTMENT_CANCELLED', OLD.id,
      pg_catalog.jsonb_build_object('startsAt', OLD."startsAt", 'branchId', OLD."branchId", 'reason', 'reassigned'));
    IF NOT (NEW.status::text = ANY (c_closed)) THEN
      PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_BOOKED', NEW.id, v_data);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CANCELLED' THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_CANCELLED', NEW.id,
      v_data || pg_catalog.jsonb_build_object('reason', 'cancelled'));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'CHECKED_IN' THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_CHECKED_IN', NEW.id, v_data);
  ELSIF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" AND NOT (NEW.status::text = ANY (c_closed)) THEN
    PERFORM app.add_notification(NEW."clinicId", 'PERSONAL', v_doctor, NULL, NULL, 'APPOINTMENT_RESCHEDULED', NEW.id,
      v_data || pg_catalog.jsonb_build_object('previousStartsAt', OLD."startsAt"));
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.notify_appointment_change() FROM PUBLIC;
CREATE TRIGGER notify_appointments AFTER INSERT OR UPDATE OF status, "startsAt", "doctorId" ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.notify_appointment_change();

-- Usable stock crossing its threshold -> branch notification for inventory
-- viewers. Usable = unexpired batches (IST day), as in src/server/data/inventory-rules.ts.
CREATE FUNCTION app.notify_stock_level() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c_perms constant text[] := ARRAY['pharmacy.inventory.view', 'pharmacy.inventory.manage', 'pharmacy.manage'];
  v_today  date := (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_item   public.inventory_items%ROWTYPE;
  v_level  integer;
  v_after  integer;
  v_before integer;
  v_name   text;
BEGIN
  SELECT * INTO v_item FROM public.inventory_items WHERE id = NEW."inventoryItemId";
  -- Serialise threshold checks per (branch, medicine): concurrent movements on
  -- different batches then see each other's committed totals (READ COMMITTED
  -- takes a fresh snapshot per statement), so a crossing is reported once.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:stock:' || v_item."branchId" || ':' || v_item."medicineId", 0));
  SELECT coalesce(pg_catalog.sum(i."quantityOnHand"), 0)::integer INTO v_after FROM public.inventory_items i
   WHERE i."clinicId" = v_item."clinicId" AND i."branchId" = v_item."branchId"
     AND i."medicineId" = v_item."medicineId" AND i."expiryDate" >= v_today;
  v_before := v_after - CASE WHEN v_item."expiryDate" >= v_today THEN NEW."quantityDelta" ELSE 0 END;
  SELECT r."reorderLevel" INTO v_level FROM public.inventory_reorder_levels r
   WHERE r."clinicId" = v_item."clinicId" AND r."branchId" = v_item."branchId" AND r."medicineId" = v_item."medicineId";
  v_level := coalesce(v_level, 0);
  SELECT pg_catalog.left(m.name, 120) INTO v_name FROM public.medicines m WHERE m.id = v_item."medicineId";

  IF v_after = 0 AND v_before > 0 THEN
    PERFORM app.add_notification(v_item."clinicId", 'BRANCH', NULL, v_item."branchId", c_perms, 'STOCK_OUT', v_item."medicineId",
      pg_catalog.jsonb_build_object('medicineName', v_name, 'usable', 0, 'reorderLevel', v_level));
  ELSIF v_level > 0 AND v_after <= v_level AND v_before > v_level THEN
    PERFORM app.add_notification(v_item."clinicId", 'BRANCH', NULL, v_item."branchId", c_perms, 'STOCK_LOW', v_item."medicineId",
      pg_catalog.jsonb_build_object('medicineName', v_name, 'usable', v_after, 'reorderLevel', v_level));
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.notify_stock_level() FROM PUBLIC;
CREATE TRIGGER notify_stock_level AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.notify_stock_level();

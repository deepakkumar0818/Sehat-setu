-- Super admin console, part 2: what each clinic pays Sehat Setu, plan limits,
-- a per-clinic detail view, editing a clinic and its administrators, and the
-- platform activity log.
-- * platform_plans: the plans on offer (price per month / year, and the most
--   branches, doctors and staff a clinic on it may have; NULL = unlimited).
-- * clinic_subscriptions: one row per clinic: its plan, billing cycle, agreed
--   price and the date it has paid until. Clinics added from the console start
--   on a 30-day free trial; clinics created any other way (seed scripts) have
--   no row and no limits.
-- * clinic_subscription_payments: money a clinic paid Sehat Setu, recorded by
--   a super admin (cash / UPI / bank / ...). Recording one extends paid-until;
--   voiding the latest one takes it back.
-- * Plan limits are checked by triggers when a branch, doctor or staff member
--   is added or reactivated (and when staff are invited), raising
--   'plan: LIMIT_<BRANCHES|DOCTORS|STAFF>'. A super admin is never blocked.
-- * Auto-suspend (opt-in per clinic): app.platform_enforce_subscriptions()
--   suspends clinics past paid-until + grace days; recording a payment
--   reactivates a clinic it suspended.
-- All three tables are closed to the runtime role (no grants, RLS with no
-- policies); everything goes through SECURITY DEFINER functions that first
-- check app.is_platform_admin(). Every change is written to audit_events.
-- Refusals: 'platform: <CODE>' with CODE in NOT_PERMITTED, INVALID_INPUT,
-- NOT_FOUND, DUPLICATE_PLAN, ADMIN_DISABLED, ALREADY_ADMIN, LAST_ADMIN,
-- NO_SUBSCRIPTION, ALREADY_VOIDED, NOT_LATEST.
-- Additive only.

CREATE TABLE "platform_plans" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"               text NOT NULL UNIQUE CHECK ("key" ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  "name"              text NOT NULL CHECK (length(btrim("name")) BETWEEN 2 AND 60),
  "monthlyPricePaise" integer NOT NULL CHECK ("monthlyPricePaise" BETWEEN 0 AND 100000000),
  "yearlyPricePaise"  integer NOT NULL CHECK ("yearlyPricePaise" BETWEEN 0 AND 1000000000),
  "maxBranches"       integer CHECK ("maxBranches" BETWEEN 1 AND 1000),
  "maxDoctors"        integer CHECK ("maxDoctors" BETWEEN 1 AND 10000),
  "maxStaff"          integer CHECK ("maxStaff" BETWEEN 1 AND 10000),
  "isActive"          boolean NOT NULL DEFAULT true,
  "sortOrder"         integer NOT NULL DEFAULT 0,
  "createdAt"         timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE "clinic_subscriptions" (
  "clinicId"               uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
  "planId"                 uuid NOT NULL REFERENCES platform_plans(id) ON DELETE RESTRICT,
  "billingCycle"           text NOT NULL DEFAULT 'MONTHLY' CHECK ("billingCycle" IN ('MONTHLY', 'YEARLY')),
  "pricePaise"             integer NOT NULL CHECK ("pricePaise" BETWEEN 0 AND 1000000000),
  "paidUntil"              date NOT NULL,
  "autoSuspend"            boolean NOT NULL DEFAULT false,
  "graceDays"              integer NOT NULL DEFAULT 7 CHECK ("graceDays" BETWEEN 0 AND 90),
  "suspendedForNonPayment" boolean NOT NULL DEFAULT false,
  "notes"                  text CHECK (length("notes") <= 1000),
  "createdAt"              timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX clinic_subscriptions_plan_idx ON clinic_subscriptions ("planId");

CREATE TABLE "clinic_subscription_payments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"         uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "amountPaise"      integer NOT NULL CHECK ("amountPaise" BETWEEN 1 AND 1000000000),
  "method"           text NOT NULL CHECK ("method" IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')),
  "reference"        text CHECK (length("reference") <= 120),
  "paidOn"           date NOT NULL,
  "months"           integer NOT NULL CHECK ("months" BETWEEN 1 AND 36),
  "periodFrom"       date NOT NULL,
  "periodTo"         date NOT NULL CHECK ("periodTo" >= "periodFrom"),
  "previousPaidUntil" date NOT NULL,
  "notes"            text CHECK (length("notes") <= 500),
  "recordedByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "voidedAt"         timestamptz(6),
  "voidReason"       text CHECK (length("voidReason") <= 300),
  "voidedByUserId"   uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX clinic_subscription_payments_clinic_idx ON clinic_subscription_payments ("clinicId", "paidOn" DESC);

REVOKE ALL ON platform_plans, clinic_subscriptions, clinic_subscription_payments FROM anon, authenticated, sehat_app;
ALTER TABLE platform_plans ENABLE ROW LEVEL SECURITY;               -- no policies: unreadable by the runtime role
ALTER TABLE clinic_subscriptions ENABLE ROW LEVEL SECURITY;         -- no policies
ALTER TABLE clinic_subscription_payments ENABLE ROW LEVEL SECURITY; -- no policies

-- Starting plans (prices and limits are editable from the console).
INSERT INTO platform_plans ("key", "name", "monthlyPricePaise", "yearlyPricePaise", "maxBranches", "maxDoctors", "maxStaff", "sortOrder") VALUES
  ('TRIAL',      'Free trial',   0,      0,       2,    5,    15,   0),
  ('BASIC',      'Basic',        99900,  999000,  1,    3,    10,   1),
  ('PRO',        'Professional', 249900, 2499000, 3,    10,   30,   2),
  ('ENTERPRISE', 'Enterprise',   499900, 4999000, NULL, NULL, NULL, 3);

-- Clinics already on Sehat Setu start a 30-day free trial (no limit applies
-- until a plan is chosen whose limits they exceed; existing records stay).
INSERT INTO clinic_subscriptions ("clinicId", "planId", "pricePaise", "paidUntil")
SELECT c.id, p.id, 0, ((now() AT TIME ZONE 'Asia/Kolkata')::date + 30)
  FROM clinics c CROSS JOIN platform_plans p WHERE p."key" = 'TRIAL';

-- India's calendar date (subscriptions are dated, not timed).
CREATE FUNCTION app.ist_today() RETURNS date
  LANGUAGE sql STABLE SET search_path = '' AS
$$ SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date $$;
REVOKE ALL ON FUNCTION app.ist_today() FROM PUBLIC;

-- A clinic added from the console starts a 30-day free trial.
CREATE FUNCTION app.start_platform_clinic_trial() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF app.is_platform_admin() THEN
    INSERT INTO public.clinic_subscriptions ("clinicId", "planId", "pricePaise", "paidUntil")
    SELECT NEW.id, p.id, 0, app.ist_today() + 30 FROM public.platform_plans p WHERE p."key" = 'TRIAL'
    ON CONFLICT ("clinicId") DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.start_platform_clinic_trial() FROM PUBLIC;
CREATE TRIGGER start_platform_clinic_trial AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION app.start_platform_clinic_trial();

-- ---------------------------------------------------------------------------
-- Plan limits
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.enforce_plan_limit() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_kind  text;
  v_max   integer;
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'branches' THEN
    IF NEW.status::text <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'ACTIVE') THEN RETURN NEW; END IF;
    v_kind := 'BRANCHES';
  ELSIF TG_TABLE_NAME = 'doctor_profiles' THEN
    IF NEW.status::text <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'ACTIVE') THEN RETURN NEW; END IF;
    v_kind := 'DOCTORS';
  ELSIF TG_TABLE_NAME = 'clinic_memberships' THEN
    IF NEW.status::text <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'ACTIVE' AND OLD."roleId" = NEW."roleId") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = NEW."roleId" AND r.key::text = 'PATIENT') THEN RETURN NEW; END IF;
    v_kind := 'STAFF';
  ELSIF TG_TABLE_NAME = 'staff_invitations' THEN
    IF NEW.status::text <> 'PENDING' THEN RETURN NEW; END IF;
    v_kind := 'STAFF';
  ELSIF TG_TABLE_NAME = 'staff_invitation_doctor_details' THEN
    v_kind := 'DOCTORS';
  ELSE
    RETURN NEW;
  END IF;

  IF app.is_platform_admin() THEN RETURN NEW; END IF;
  SELECT CASE v_kind WHEN 'BRANCHES' THEN p."maxBranches" WHEN 'DOCTORS' THEN p."maxDoctors" ELSE p."maxStaff" END
    INTO v_max
    FROM public.clinic_subscriptions s JOIN public.platform_plans p ON p.id = s."planId"
   WHERE s."clinicId" = NEW."clinicId";
  IF v_max IS NULL THEN RETURN NEW; END IF;

  -- One check at a time per clinic and kind, so two additions can't both squeeze in.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('plan-limit:' || NEW."clinicId"::text || ':' || v_kind));

  IF v_kind = 'BRANCHES' THEN
    SELECT pg_catalog.count(*) INTO v_count FROM public.branches b
     WHERE b."clinicId" = NEW."clinicId" AND b.status = 'ACTIVE' AND b.id <> NEW.id;
  ELSIF TG_TABLE_NAME = 'doctor_profiles' THEN
    SELECT pg_catalog.count(*) INTO v_count FROM public.doctor_profiles d
     WHERE d."clinicId" = NEW."clinicId" AND d.status = 'ACTIVE' AND d.id <> NEW.id;
  ELSIF TG_TABLE_NAME = 'clinic_memberships' THEN
    SELECT pg_catalog.count(DISTINCT m."userId") INTO v_count FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
     WHERE m."clinicId" = NEW."clinicId" AND m.status = 'ACTIVE' AND r.key::text <> 'PATIENT' AND m.id <> NEW.id AND m."userId" <> NEW."userId";
  ELSIF TG_TABLE_NAME = 'staff_invitations' THEN
    -- Staff now, plus invitations still open (each holds a place).
    SELECT (SELECT pg_catalog.count(DISTINCT m."userId") FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
             WHERE m."clinicId" = NEW."clinicId" AND m.status = 'ACTIVE' AND r.key::text <> 'PATIENT')
         + (SELECT pg_catalog.count(*) FROM public.staff_invitations i
             WHERE i."clinicId" = NEW."clinicId" AND i.status = 'PENDING' AND i."expiresAt" > pg_catalog.now() AND i.id <> NEW.id)
      INTO v_count;
  ELSE
    SELECT (SELECT pg_catalog.count(*) FROM public.doctor_profiles d WHERE d."clinicId" = NEW."clinicId" AND d.status = 'ACTIVE')
         + (SELECT pg_catalog.count(*) FROM public.staff_invitation_doctor_details dd JOIN public.staff_invitations i ON i.id = dd."invitationId"
             WHERE dd."clinicId" = NEW."clinicId" AND i.status = 'PENDING' AND i."expiresAt" > pg_catalog.now() AND dd."invitationId" <> NEW."invitationId")
      INTO v_count;
  END IF;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'plan: LIMIT_% %', v_kind, v_max USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.enforce_plan_limit() FROM PUBLIC;
CREATE TRIGGER plan_limit_branches BEFORE INSERT OR UPDATE OF status ON branches FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limit();
CREATE TRIGGER plan_limit_doctors BEFORE INSERT OR UPDATE OF status ON doctor_profiles FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limit();
CREATE TRIGGER plan_limit_staff BEFORE INSERT OR UPDATE OF status, "roleId" ON clinic_memberships FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limit();
CREATE TRIGGER plan_limit_staff_invitations BEFORE INSERT ON staff_invitations FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limit();
CREATE TRIGGER plan_limit_doctor_invitations BEFORE INSERT ON staff_invitation_doctor_details FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limit();

-- ---------------------------------------------------------------------------
-- Shared pieces
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_subscription_json(p_clinic uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT pg_catalog.jsonb_build_object(
           'planId', p.id, 'planKey', p."key", 'planName', p.name,
           'billingCycle', s."billingCycle", 'pricePaise', s."pricePaise", 'paidUntil', s."paidUntil",
           'autoSuspend', s."autoSuspend", 'graceDays', s."graceDays", 'suspendedForNonPayment', s."suspendedForNonPayment",
           'notes', s.notes, 'maxBranches', p."maxBranches", 'maxDoctors', p."maxDoctors", 'maxStaff', p."maxStaff")
    FROM public.clinic_subscriptions s JOIN public.platform_plans p ON p.id = s."planId"
   WHERE s."clinicId" = p_clinic
$$;
REVOKE ALL ON FUNCTION app.platform_subscription_json(uuid) FROM PUBLIC;

CREATE FUNCTION app.platform_require_clinic(p_clinic uuid) RETURNS public.clinics
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE v public.clinics%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.clinics WHERE id = p_clinic;
  IF v.id IS NULL THEN RAISE EXCEPTION 'platform: NOT_FOUND' USING ERRCODE = '22023'; END IF;
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION app.platform_require_clinic(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Every clinic, now with its subscription (replaces the part-1 version)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.platform_clinic_overview() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_month timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  v jsonb;
BEGIN
  PERFORM app.require_platform_admin();
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', c.id, 'code', c.code, 'name', c.name, 'email', c.email, 'phone', c.phone,
           'addressLine', c."addressLine", 'city', c.city, 'state', c.state, 'pincode', c.pincode,
           'status', c.status, 'createdAt', c."createdAt",
           'branches', (SELECT pg_catalog.count(*) FROM public.branches b WHERE b."clinicId" = c.id AND b.status = 'ACTIVE'),
           'staff', (SELECT pg_catalog.count(DISTINCT m."userId") FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
                      WHERE m."clinicId" = c.id AND m.status = 'ACTIVE' AND r.key <> 'PATIENT'),
           'doctors', (SELECT pg_catalog.count(*) FROM public.doctor_profiles d WHERE d."clinicId" = c.id AND d.status = 'ACTIVE'),
           'patients', (SELECT pg_catalog.count(*) FROM public.patients p WHERE p."clinicId" = c.id AND p.status <> 'ARCHIVED'),
           'appointmentsThisMonth', (SELECT pg_catalog.count(*) FROM public.appointments a
                                      WHERE a."clinicId" = c.id AND a."startsAt" >= v_month AND a.status::text <> ALL (ARRAY['CANCELLED', 'REJECTED'])),
           'upcomingAppointments', (SELECT pg_catalog.count(*) FROM public.appointments a
                                     WHERE a."clinicId" = c.id AND a."startsAt" >= pg_catalog.now()
                                       AND a.status::text = ANY (ARRAY['PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED'])),
           'revenueThisMonthPaise', (SELECT coalesce(pg_catalog.sum(pm."amountPaise"), 0) FROM public.payments pm
                                      WHERE pm."clinicId" = c.id AND pm.status = 'SUCCEEDED' AND pm."paidAt" >= v_month),
           'lastActivityAt', (SELECT pg_catalog.max(e."occurredAt") FROM public.audit_events e WHERE e."clinicId" = c.id AND e."occurredAt" <= pg_catalog.now()),
           'admins', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId', u.id, 'name', u.name, 'email', u.email, 'status', u.status) ORDER BY u.name), '[]'::jsonb)
                        FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId" JOIN public.users u ON u.id = m."userId"
                       WHERE m."clinicId" = c.id AND m.status = 'ACTIVE' AND r.key = 'ADMINISTRATOR'),
           'subscription', app.platform_subscription_json(c.id),
           'subscriptionCollectedThisMonthPaise', (SELECT coalesce(pg_catalog.sum(sp."amountPaise"), 0) FROM public.clinic_subscription_payments sp
                                                    WHERE sp."clinicId" = c.id AND sp."voidedAt" IS NULL AND sp."paidOn" >= pg_catalog.date_trunc('month', app.ist_today())::date)
         ) ORDER BY c."createdAt" DESC, c.name), '[]'::jsonb)
    INTO v FROM public.clinics c;
  RETURN v;
END
$$;

-- ---------------------------------------------------------------------------
-- One clinic in detail (people, branches, usage, payments, recent activity).
-- Names and roles of the clinic's people; no patient, clinical or billing record.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_clinic_detail(p_clinic uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c public.clinics%ROWTYPE;
BEGIN
  PERFORM app.require_platform_admin();
  c := app.platform_require_clinic(p_clinic);
  RETURN pg_catalog.jsonb_build_object(
    'id', c.id, 'code', c.code, 'name', c.name, 'email', c.email, 'phone', c.phone,
    'addressLine', c."addressLine", 'city', c.city, 'state', c.state, 'pincode', c.pincode,
    'status', c.status, 'createdAt', c."createdAt",
    'subscription', app.platform_subscription_json(c.id),
    'counts', pg_catalog.jsonb_build_object(
      'branches', (SELECT pg_catalog.count(*) FROM public.branches b WHERE b."clinicId" = c.id AND b.status = 'ACTIVE'),
      'doctors', (SELECT pg_catalog.count(*) FROM public.doctor_profiles d WHERE d."clinicId" = c.id AND d.status = 'ACTIVE'),
      'staff', (SELECT pg_catalog.count(DISTINCT m."userId") FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
                 WHERE m."clinicId" = c.id AND m.status = 'ACTIVE' AND r.key <> 'PATIENT'),
      'pendingInvitations', (SELECT pg_catalog.count(*) FROM public.staff_invitations i
                              WHERE i."clinicId" = c.id AND i.status = 'PENDING' AND i."expiresAt" > pg_catalog.now()),
      'patients', (SELECT pg_catalog.count(*) FROM public.patients p WHERE p."clinicId" = c.id AND p.status <> 'ARCHIVED'),
      'portalPatients', (SELECT pg_catalog.count(*) FROM public.patients p WHERE p."clinicId" = c.id AND p.status <> 'ARCHIVED' AND p."userId" IS NOT NULL)),
    'branches', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', b.id, 'code', b.code, 'name', b.name, 'city', b.city, 'phone', b.phone,
                   'isHeadOffice', b."isHeadOffice", 'status', b.status) ORDER BY b."isHeadOffice" DESC, b.name), '[]'::jsonb)
                   FROM public.branches b WHERE b."clinicId" = c.id),
    'people', (SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'status', x->>'name'), '[]'::jsonb) FROM (
                 SELECT pg_catalog.jsonb_build_object(
                          'userId', u.id, 'name', u.name, 'email', u.email, 'accountStatus', u.status,
                          'status', CASE WHEN pg_catalog.bool_or(m.status = 'ACTIVE') THEN 'ACTIVE' ELSE 'INACTIVE' END,
                          'roles', pg_catalog.jsonb_agg(DISTINCT r.name) FILTER (WHERE m.status = 'ACTIVE'),
                          'isAdmin', pg_catalog.bool_or(m.status = 'ACTIVE' AND r.key = 'ADMINISTRATOR'),
                          'branch', (SELECT b.name FROM public.clinic_memberships m2 JOIN public.branches b ON b.id = m2."branchId"
                                      WHERE m2."clinicId" = c.id AND m2."userId" = u.id AND m2.status = 'ACTIVE' LIMIT 1),
                          'specialty', (SELECT sp.name FROM public.doctor_profiles d JOIN public.specialties sp ON sp.id = d."specialtyId"
                                         WHERE d."clinicId" = c.id AND d."userId" = u.id AND d.status = 'ACTIVE' LIMIT 1),
                          'since', pg_catalog.min(m."createdAt")) AS x
                   FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId" JOIN public.users u ON u.id = m."userId"
                  WHERE m."clinicId" = c.id AND r.key <> 'PATIENT'
                  GROUP BY u.id) people),
    -- Months are stepped in India's calendar, then turned into instants.
    'usage', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'month', pg_catalog.to_char(lm, 'YYYY-MM'),
                'appointments', (SELECT pg_catalog.count(*) FROM public.appointments a
                                  WHERE a."clinicId" = c.id AND a."startsAt" >= b.mo AND a."startsAt" < b.mo_end
                                    AND a.status::text <> ALL (ARRAY['CANCELLED', 'REJECTED'])),
                'newPatients', (SELECT pg_catalog.count(*) FROM public.patients p
                                 WHERE p."clinicId" = c.id AND p."createdAt" >= b.mo AND p."createdAt" < b.mo_end),
                'collectedPaise', (SELECT coalesce(pg_catalog.sum(pm."amountPaise"), 0) FROM public.payments pm
                                    WHERE pm."clinicId" = c.id AND pm.status = 'SUCCEEDED' AND pm."paidAt" >= b.mo AND pm."paidAt" < b.mo_end)
              ) ORDER BY lm)
                FROM pg_catalog.generate_series(pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months',
                                                pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Asia/Kolkata'), interval '1 month') AS lm,
                     LATERAL (SELECT lm AT TIME ZONE 'Asia/Kolkata' AS mo, (lm + interval '1 month') AT TIME ZONE 'Asia/Kolkata' AS mo_end) b),
    'payments', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', sp.id, 'amountPaise', sp."amountPaise", 'method', sp.method, 'reference', sp.reference,
                   'paidOn', sp."paidOn", 'months', sp.months, 'periodFrom', sp."periodFrom", 'periodTo', sp."periodTo",
                   'notes', sp.notes, 'recordedBy', ru.name, 'createdAt', sp."createdAt",
                   'voidedAt', sp."voidedAt", 'voidReason', sp."voidReason") ORDER BY sp."paidOn" DESC, sp."createdAt" DESC), '[]'::jsonb)
                   FROM public.clinic_subscription_payments sp LEFT JOIN public.users ru ON ru.id = sp."recordedByUserId"
                  WHERE sp."clinicId" = c.id)
  );
END
$$;
REVOKE ALL ON FUNCTION app.platform_clinic_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_clinic_detail(uuid) TO sehat_app;

-- ---------------------------------------------------------------------------
-- Editing a clinic and its administrators
-- ---------------------------------------------------------------------------
-- The code is fixed (it's in every patient and bill number).
CREATE FUNCTION app.platform_update_clinic(
  p_clinic uuid, p_name text, p_email text, p_phone text, p_address text, p_city text, p_state text, p_pincode text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c       public.clinics%ROWTYPE;
  v_name  text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_phone text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_addr  text := pg_catalog.btrim(coalesce(p_address, ''));
  v_city  text := pg_catalog.btrim(coalesce(p_city, ''));
  v_state text := pg_catalog.btrim(coalesce(p_state, ''));
  v_pin   text := pg_catalog.btrim(coalesce(p_pincode, ''));
  v_changed text[];
BEGIN
  PERFORM app.require_platform_admin();
  c := app.platform_require_clinic(p_clinic);
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR pg_catalog.length(v_email) > 254
     OR v_phone !~ '^\+?[0-9][0-9 -]{6,18}[0-9]$' OR pg_catalog.length(v_addr) NOT BETWEEN 1 AND 300
     OR pg_catalog.length(v_city) NOT BETWEEN 1 AND 80 OR pg_catalog.length(v_state) NOT BETWEEN 1 AND 80 OR v_pin !~ '^[1-9][0-9]{5}$' THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  v_changed := ARRAY(SELECT f FROM (VALUES
    ('name', c.name IS DISTINCT FROM v_name), ('email', c.email IS DISTINCT FROM v_email), ('phone', c.phone IS DISTINCT FROM v_phone),
    ('addressLine', c."addressLine" IS DISTINCT FROM v_addr), ('city', c.city IS DISTINCT FROM v_city),
    ('state', c.state IS DISTINCT FROM v_state), ('pincode', c.pincode IS DISTINCT FROM v_pin)) t(f, changed) WHERE changed);
  IF pg_catalog.cardinality(v_changed) = 0 THEN RETURN; END IF;
  UPDATE public.clinics SET name = v_name, email = v_email, phone = v_phone, "addressLine" = v_addr, city = v_city,
         state = v_state, pincode = v_pin, "updatedAt" = pg_catalog.now()
   WHERE id = p_clinic;
  PERFORM app.platform_audit('platform.clinic_updated', p_clinic, pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(v_changed)));
END
$$;
REVOKE ALL ON FUNCTION app.platform_update_clinic(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_update_clinic(uuid, text, text, text, text, text, text, text) TO sehat_app;

-- Makes someone (an existing account by email, or a new INVITED one) an administrator of the clinic.
CREATE FUNCTION app.platform_add_clinic_admin(p_clinic uuid, p_name text, p_email text)
  RETURNS TABLE (admin_user_id uuid, admin_is_new boolean, admin_signed_in boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_name  text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_role  uuid;
  v_user  public.users%ROWTYPE;
  v_new   boolean := false;
  v_mem   public.clinic_memberships%ROWTYPE;
BEGIN
  PERFORM app.require_platform_admin();
  PERFORM app.platform_require_clinic(p_clinic);
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR pg_catalog.length(v_email) > 254 THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE key = 'ADMINISTRATOR';
  SELECT * INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_email;
  IF v_user.id IS NULL THEN
    INSERT INTO public.users (id, email, name, status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_email, v_name, 'INVITED', pg_catalog.now())
    RETURNING * INTO v_user;
    v_new := true;
  ELSIF v_user.status = 'DISABLED' THEN
    RAISE EXCEPTION 'platform: ADMIN_DISABLED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_mem FROM public.clinic_memberships m WHERE m."clinicId" = p_clinic AND m."userId" = v_user.id AND m."roleId" = v_role;
  IF v_mem.id IS NOT NULL AND v_mem.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'platform: ALREADY_ADMIN' USING ERRCODE = '23505';
  ELSIF v_mem.id IS NOT NULL THEN
    UPDATE public.clinic_memberships SET status = 'ACTIVE', "updatedAt" = pg_catalog.now() WHERE id = v_mem.id;
  ELSE
    INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "roleId", status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_user.id, p_clinic, v_role, 'ACTIVE', pg_catalog.now());
  END IF;
  PERFORM app.platform_audit('platform.admin_added', p_clinic, pg_catalog.jsonb_build_object('userId', v_user.id, 'adminIsNew', v_new));
  admin_user_id := v_user.id;
  admin_is_new := v_new;
  -- Already signs in with a linked login: nothing to email.
  admin_signed_in := v_user."authProviderId" IS NOT NULL AND v_user.status = 'ACTIVE';
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION app.platform_add_clinic_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_add_clinic_admin(uuid, text, text) TO sehat_app;

-- Takes the administrator role away (any other role they hold at the clinic stays). Never the last one.
CREATE FUNCTION app.platform_remove_clinic_admin(p_clinic uuid, p_user uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE v_role uuid;
BEGIN
  PERFORM app.require_platform_admin();
  PERFORM app.platform_require_clinic(p_clinic);
  SELECT id INTO v_role FROM public.roles WHERE key = 'ADMINISTRATOR';
  PERFORM 1 FROM public.clinic_memberships m WHERE m."clinicId" = p_clinic AND m."roleId" = v_role AND m.status = 'ACTIVE' FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.clinic_memberships m WHERE m."clinicId" = p_clinic AND m."userId" = p_user AND m."roleId" = v_role AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'platform: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clinic_memberships m WHERE m."clinicId" = p_clinic AND m."roleId" = v_role AND m.status = 'ACTIVE' AND m."userId" <> p_user) THEN
    RAISE EXCEPTION 'platform: LAST_ADMIN' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clinic_memberships SET status = 'INACTIVE', "updatedAt" = pg_catalog.now()
   WHERE "clinicId" = p_clinic AND "userId" = p_user AND "roleId" = v_role;
  PERFORM app.platform_audit('platform.admin_removed', p_clinic, pg_catalog.jsonb_build_object('userId', p_user));
END
$$;
REVOKE ALL ON FUNCTION app.platform_remove_clinic_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_remove_clinic_admin(uuid, uuid) TO sehat_app;

-- Manual reactivation also clears the "suspended for non-payment" flag (replaces the part-1 version).
CREATE OR REPLACE FUNCTION app.platform_set_clinic_status(p_clinic uuid, p_status text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.require_platform_admin();
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clinics SET status = p_status::public."ClinicStatus", "updatedAt" = pg_catalog.now()
   WHERE id = p_clinic AND status::text IS DISTINCT FROM p_status;
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.clinics WHERE id = p_clinic) THEN
    RAISE EXCEPTION 'platform: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clinic_subscriptions SET "suspendedForNonPayment" = false, "updatedAt" = pg_catalog.now()
   WHERE "clinicId" = p_clinic AND "suspendedForNonPayment";
  PERFORM app.platform_audit(CASE p_status WHEN 'ACTIVE' THEN 'platform.clinic_activated' ELSE 'platform.clinic_suspended' END, p_clinic, NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_plans() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.require_platform_admin();
  RETURN (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', p.id, 'key', p."key", 'name', p.name, 'monthlyPricePaise', p."monthlyPricePaise", 'yearlyPricePaise', p."yearlyPricePaise",
            'maxBranches', p."maxBranches", 'maxDoctors', p."maxDoctors", 'maxStaff', p."maxStaff", 'isActive', p."isActive",
            'clinics', (SELECT pg_catalog.count(*) FROM public.clinic_subscriptions s WHERE s."planId" = p.id)
          ) ORDER BY p."sortOrder", p.name), '[]'::jsonb) FROM public.platform_plans p);
END
$$;
REVOKE ALL ON FUNCTION app.platform_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_plans() TO sehat_app;

-- p_id NULL: a new plan (with p_key); otherwise edits that plan (its key never changes).
-- Lower limits don't remove anything a clinic already has; they only stop new additions.
CREATE FUNCTION app.platform_save_plan(
  p_id uuid, p_key text, p_name text, p_monthly integer, p_yearly integer,
  p_max_branches integer, p_max_doctors integer, p_max_staff integer, p_active boolean
) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_key  text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_key, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_id   uuid := p_id;
BEGIN
  PERFORM app.require_platform_admin();
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 60 OR p_monthly IS NULL OR p_monthly NOT BETWEEN 0 AND 100000000
     OR p_yearly IS NULL OR p_yearly NOT BETWEEN 0 AND 1000000000
     OR p_max_branches NOT BETWEEN 1 AND 1000 OR p_max_doctors NOT BETWEEN 1 AND 10000 OR p_max_staff NOT BETWEEN 1 AND 10000
     OR p_active IS NULL THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    IF v_key !~ '^[A-Z][A-Z0-9_]{1,29}$' THEN RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.platform_plans WHERE "key" = v_key) THEN RAISE EXCEPTION 'platform: DUPLICATE_PLAN' USING ERRCODE = '23505'; END IF;
    INSERT INTO public.platform_plans ("key", name, "monthlyPricePaise", "yearlyPricePaise", "maxBranches", "maxDoctors", "maxStaff", "isActive", "sortOrder")
    VALUES (v_key, v_name, p_monthly, p_yearly, p_max_branches, p_max_doctors, p_max_staff, p_active,
            (SELECT coalesce(pg_catalog.max("sortOrder"), 0) + 1 FROM public.platform_plans))
    RETURNING id INTO v_id;
    PERFORM app.platform_audit('platform.plan_created', NULL, pg_catalog.jsonb_build_object('planId', v_id, 'key', v_key));
  ELSE
    UPDATE public.platform_plans SET name = v_name, "monthlyPricePaise" = p_monthly, "yearlyPricePaise" = p_yearly,
           "maxBranches" = p_max_branches, "maxDoctors" = p_max_doctors, "maxStaff" = p_max_staff, "isActive" = p_active,
           "updatedAt" = pg_catalog.now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'platform: NOT_FOUND' USING ERRCODE = '22023'; END IF;
    PERFORM app.platform_audit('platform.plan_updated', NULL, pg_catalog.jsonb_build_object('planId', v_id));
  END IF;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app.platform_save_plan(uuid, text, text, integer, integer, integer, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_save_plan(uuid, text, text, integer, integer, integer, integer, integer, boolean) TO sehat_app;

-- ---------------------------------------------------------------------------
-- A clinic's subscription and payments
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_set_subscription(
  p_clinic uuid, p_plan uuid, p_cycle text, p_price integer, p_paid_until date, p_auto_suspend boolean, p_grace integer, p_notes text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_old   public.clinic_subscriptions%ROWTYPE;
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
BEGIN
  PERFORM app.require_platform_admin();
  PERFORM app.platform_require_clinic(p_clinic);
  IF p_cycle IS NULL OR p_cycle NOT IN ('MONTHLY', 'YEARLY') OR p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000000
     OR p_paid_until IS NULL OR p_paid_until NOT BETWEEN DATE '2020-01-01' AND DATE '2100-12-31'
     OR p_auto_suspend IS NULL OR p_grace IS NULL OR p_grace NOT BETWEEN 0 AND 90 OR pg_catalog.length(v_notes) > 1000
     OR NOT EXISTS (SELECT 1 FROM public.platform_plans WHERE id = p_plan) THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.clinic_subscriptions WHERE "clinicId" = p_clinic FOR UPDATE;
  INSERT INTO public.clinic_subscriptions ("clinicId", "planId", "billingCycle", "pricePaise", "paidUntil", "autoSuspend", "graceDays", notes)
  VALUES (p_clinic, p_plan, p_cycle, p_price, p_paid_until, p_auto_suspend, p_grace, v_notes)
  ON CONFLICT ("clinicId") DO UPDATE SET "planId" = EXCLUDED."planId", "billingCycle" = EXCLUDED."billingCycle",
     "pricePaise" = EXCLUDED."pricePaise", "paidUntil" = EXCLUDED."paidUntil", "autoSuspend" = EXCLUDED."autoSuspend",
     "graceDays" = EXCLUDED."graceDays", notes = EXCLUDED.notes, "updatedAt" = pg_catalog.now();
  PERFORM app.platform_audit('platform.subscription_updated', p_clinic, pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'planId', p_plan, 'previousPlanId', v_old."planId", 'billingCycle', p_cycle, 'pricePaise', p_price,
    'paidUntil', p_paid_until, 'previousPaidUntil', v_old."paidUntil", 'autoSuspend', p_auto_suspend)));
END
$$;
REVOKE ALL ON FUNCTION app.platform_set_subscription(uuid, uuid, text, integer, date, boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_set_subscription(uuid, uuid, text, integer, date, boolean, integer, text) TO sehat_app;

-- Records money received and extends paid-until by p_months: from the day after
-- the current paid-until, or from the payment date if that has already passed.
-- A clinic auto-suspended for non-payment is reactivated once it's paid up.
CREATE FUNCTION app.platform_record_subscription_payment(
  p_clinic uuid, p_amount integer, p_method text, p_reference text, p_paid_on date, p_months integer, p_notes text
) RETURNS TABLE (payment_id uuid, paid_until date, reactivated boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_sub   public.clinic_subscriptions%ROWTYPE;
  v_ref   text := nullif(pg_catalog.btrim(coalesce(p_reference, '')), '');
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_from  date;
  v_to    date;
  v_id    uuid;
  v_react boolean := false;
BEGIN
  PERFORM app.require_platform_admin();
  PERFORM app.platform_require_clinic(p_clinic);
  IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 1000000000
     OR p_method IS NULL OR p_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')
     OR p_paid_on IS NULL OR p_paid_on > app.ist_today() OR p_paid_on < app.ist_today() - 366
     OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 36
     OR pg_catalog.length(v_ref) > 120 OR pg_catalog.length(v_notes) > 500 THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.clinic_subscriptions WHERE "clinicId" = p_clinic FOR UPDATE;
  IF v_sub."clinicId" IS NULL THEN RAISE EXCEPTION 'platform: NO_SUBSCRIPTION' USING ERRCODE = '22023'; END IF;

  v_from := GREATEST(v_sub."paidUntil" + 1, p_paid_on);
  v_to := (v_from + pg_catalog.make_interval(months => p_months))::date - 1;
  INSERT INTO public.clinic_subscription_payments ("clinicId", "amountPaise", method, reference, "paidOn", months, "periodFrom", "periodTo",
                                                   "previousPaidUntil", notes, "recordedByUserId")
  VALUES (p_clinic, p_amount, p_method, v_ref, p_paid_on, p_months, v_from, v_to, v_sub."paidUntil", v_notes, app.current_user_id())
  RETURNING id INTO v_id;
  UPDATE public.clinic_subscriptions SET "paidUntil" = v_to, "updatedAt" = pg_catalog.now() WHERE "clinicId" = p_clinic;

  IF v_sub."suspendedForNonPayment" AND v_to >= app.ist_today() THEN
    UPDATE public.clinics SET status = 'ACTIVE', "updatedAt" = pg_catalog.now() WHERE id = p_clinic AND status = 'SUSPENDED';
    v_react := FOUND;
    UPDATE public.clinic_subscriptions SET "suspendedForNonPayment" = false WHERE "clinicId" = p_clinic;
    IF v_react THEN PERFORM app.platform_audit('platform.clinic_activated', p_clinic, '{"reason":"payment"}'::jsonb); END IF;
  END IF;
  PERFORM app.platform_audit('platform.subscription_payment_recorded', p_clinic, pg_catalog.jsonb_build_object(
    'paymentId', v_id, 'amountPaise', p_amount, 'method', p_method, 'months', p_months, 'paidUntil', v_to));
  payment_id := v_id;
  paid_until := v_to;
  reactivated := v_react;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION app.platform_record_subscription_payment(uuid, integer, text, text, date, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_record_subscription_payment(uuid, integer, text, text, date, integer, text) TO sehat_app;

-- Voids a payment recorded by mistake. Only the clinic's latest valid payment
-- can be voided; paid-until goes back to what it was before it.
CREATE FUNCTION app.platform_void_subscription_payment(p_clinic uuid, p_payment uuid, p_reason text) RETURNS date
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_pay    public.clinic_subscription_payments%ROWTYPE;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM app.require_platform_admin();
  IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.clinic_subscriptions WHERE "clinicId" = p_clinic FOR UPDATE;
  SELECT * INTO v_pay FROM public.clinic_subscription_payments WHERE id = p_payment AND "clinicId" = p_clinic;
  IF v_pay.id IS NULL THEN RAISE EXCEPTION 'platform: NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_pay."voidedAt" IS NOT NULL THEN RAISE EXCEPTION 'platform: ALREADY_VOIDED' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_subscription_payments sp
              WHERE sp."clinicId" = p_clinic AND sp."voidedAt" IS NULL AND sp.id <> v_pay.id AND sp."createdAt" > v_pay."createdAt") THEN
    RAISE EXCEPTION 'platform: NOT_LATEST' USING ERRCODE = '22023';
  END IF;
  UPDATE public.clinic_subscription_payments SET "voidedAt" = pg_catalog.now(), "voidReason" = v_reason, "voidedByUserId" = app.current_user_id()
   WHERE id = v_pay.id;
  -- Only roll back if paid-until hasn't been set by hand since.
  UPDATE public.clinic_subscriptions SET "paidUntil" = v_pay."previousPaidUntil", "updatedAt" = pg_catalog.now()
   WHERE "clinicId" = p_clinic AND "paidUntil" = v_pay."periodTo";
  PERFORM app.platform_audit('platform.subscription_payment_voided', p_clinic, pg_catalog.jsonb_build_object('paymentId', v_pay.id, 'amountPaise', v_pay."amountPaise"));
  RETURN (SELECT "paidUntil" FROM public.clinic_subscriptions WHERE "clinicId" = p_clinic);
END
$$;
REVOKE ALL ON FUNCTION app.platform_void_subscription_payment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_void_subscription_payment(uuid, uuid, text) TO sehat_app;

-- Suspends every active clinic with auto-suspend on that is past paid-until +
-- grace days. Run when the console loads. Returns how many were suspended.
CREATE FUNCTION app.platform_enforce_subscriptions() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  r record;
  n integer := 0;
BEGIN
  PERFORM app.require_platform_admin();
  FOR r IN SELECT s."clinicId", s."paidUntil" FROM public.clinic_subscriptions s JOIN public.clinics c ON c.id = s."clinicId"
            WHERE s."autoSuspend" AND c.status = 'ACTIVE' AND s."paidUntil" + s."graceDays" < app.ist_today()
            FOR UPDATE OF s, c
  LOOP
    UPDATE public.clinics SET status = 'SUSPENDED', "updatedAt" = pg_catalog.now() WHERE id = r."clinicId";
    UPDATE public.clinic_subscriptions SET "suspendedForNonPayment" = true, "updatedAt" = pg_catalog.now() WHERE "clinicId" = r."clinicId";
    PERFORM app.platform_audit('platform.clinic_auto_suspended', r."clinicId", pg_catalog.jsonb_build_object('paidUntil', r."paidUntil"));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION app.platform_enforce_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_enforce_subscriptions() TO sehat_app;

-- ---------------------------------------------------------------------------
-- Activity log: every platform action, plus refusals and failures anywhere
-- (denied access, failed sign-in links, ...). Newest first, 50 at a time.
-- Details are shown only for platform actions (other events may carry
-- patient references).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_activity(p_clinic uuid, p_kind text, p_before timestamptz) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.require_platform_admin();
  IF p_kind IS NULL OR p_kind NOT IN ('all', 'platform', 'problems') THEN RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023'; END IF;
  RETURN (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', e.id, 'occurredAt', e."occurredAt", 'action', e.action, 'outcome', e.outcome, 'reason', e.reason,
            'targetType', e."targetType", 'clinicId', e."clinicId", 'clinicName', c.name, 'clinicCode', c.code,
            'actorName', u.name, 'actorEmail', u.email, 'actorLabel', e."actorLabel",
            'metadata', CASE WHEN e.action LIKE 'platform.%' THEN e.metadata END
          ) ORDER BY e."occurredAt" DESC, e.id), '[]'::jsonb)
          FROM (SELECT * FROM public.audit_events ev
                 WHERE (p_clinic IS NULL OR ev."clinicId" = p_clinic)
                   AND (p_before IS NULL OR ev."occurredAt" < p_before)
                   AND ev."occurredAt" <= pg_catalog.now()
                   AND CASE p_kind
                         WHEN 'platform' THEN ev.action LIKE 'platform.%'
                         WHEN 'problems' THEN ev.outcome <> 'SUCCESS'
                         ELSE ev.action LIKE 'platform.%' OR ev.outcome <> 'SUCCESS'
                       END
                 ORDER BY ev."occurredAt" DESC, ev.id
                 LIMIT 50) e
          LEFT JOIN public.clinics c ON c.id = e."clinicId"
          LEFT JOIN public.users u ON u.id = e."actorUserId");
END
$$;
REVOKE ALL ON FUNCTION app.platform_activity(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_activity(uuid, text, timestamptz) TO sehat_app;

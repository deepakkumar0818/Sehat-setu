-- Platform super admins: the people who run Sehat Setu itself, above every
-- clinic. A super admin belongs to no clinic and sees no patient, clinical or
-- billing records; they see each clinic's details and usage counts, add new
-- clinics (with a head-office branch and the clinic's first administrator),
-- and suspend or reactivate a clinic.
-- * platform_admins: one row per super admin user. Granted to nobody: added
--   only by an operator script on the admin connection.
-- * Every platform action is a SECURITY DEFINER function that first checks
--   app.is_platform_admin() for the verified session (the pinned user, linked
--   to the pinned Supabase login, ACTIVE). The runtime role gets no new table
--   privileges.
-- * Actions are written to audit_events ('platform.*', with the clinic).
-- Refusals: 'platform: <CODE>' with CODE in NOT_PERMITTED, INVALID_INPUT,
-- DUPLICATE_CODE, ADMIN_DISABLED, NOT_FOUND.
-- Additive only.

CREATE TABLE "platform_admins" (
  "userId"    uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_admins FROM anon, authenticated, sehat_app;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY; -- no policies: unreadable by the runtime role

-- The verified session's user is an active super admin.
CREATE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa JOIN public.users u ON u.id = pa."userId"
     WHERE pa."userId" = app.current_user_id()
       AND u."authProviderId" IS NOT NULL AND u."authProviderId" = app.current_auth_user_id()
       AND u.status = 'ACTIVE')
$$;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO sehat_app;

CREATE FUNCTION app.require_platform_admin() RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'platform: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.require_platform_admin() FROM PUBLIC;

CREATE FUNCTION app.platform_audit(p_action text, p_clinic uuid, p_metadata jsonb) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
  INSERT INTO public.audit_events ("actorUserId", "actorAuthId", "actorLabel", "clinicId", action, "targetType", "targetId", outcome, metadata)
  VALUES (app.current_user_id(), app.current_auth_user_id(), 'platform', p_clinic, p_action, 'clinics', p_clinic::text, 'SUCCESS', p_metadata)
$$;
REVOKE ALL ON FUNCTION app.platform_audit(text, uuid, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Every clinic, with usage counts (no patient, clinical or billing records)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.platform_clinic_overview() RETURNS jsonb
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
           'staff', (SELECT pg_catalog.count(*) FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
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
           'lastActivityAt', (SELECT pg_catalog.max(e."occurredAt") FROM public.audit_events e WHERE e."clinicId" = c.id),
           'admins', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', u.name, 'email', u.email, 'status', u.status) ORDER BY u.name), '[]'::jsonb)
                        FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId" JOIN public.users u ON u.id = m."userId"
                       WHERE m."clinicId" = c.id AND m.status = 'ACTIVE' AND r.key = 'ADMINISTRATOR')
         ) ORDER BY c."createdAt" DESC, c.name), '[]'::jsonb)
    INTO v FROM public.clinics c;
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION app.platform_clinic_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_clinic_overview() TO sehat_app;

-- ---------------------------------------------------------------------------
-- A new clinic: the clinic, its head-office branch and its first administrator
-- ---------------------------------------------------------------------------
-- The administrator is an existing account (by email) or a new INVITED one;
-- they sign in once a Supabase invitation is accepted (sent by the server).
-- New clinics get their settings and standard lab tests from the existing
-- triggers on clinics.
CREATE FUNCTION app.platform_create_clinic(
  p_code text, p_name text, p_email text, p_phone text, p_address text, p_city text, p_state text, p_pincode text,
  p_branch_name text, p_admin_name text, p_admin_email text
) RETURNS TABLE (clinic_id uuid, admin_user_id uuid, admin_is_new boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_code   text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  v_name   text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email  text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_phone  text := pg_catalog.btrim(coalesce(p_phone, ''));
  v_addr   text := pg_catalog.btrim(coalesce(p_address, ''));
  v_city   text := pg_catalog.btrim(coalesce(p_city, ''));
  v_state  text := pg_catalog.btrim(coalesce(p_state, ''));
  v_pin    text := pg_catalog.btrim(coalesce(p_pincode, ''));
  v_branch text := coalesce(nullif(pg_catalog.btrim(coalesce(p_branch_name, '')), ''), 'Main');
  v_aname  text := pg_catalog.btrim(coalesce(p_admin_name, ''));
  v_aemail text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_admin_email, '')));
  v_email_re constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  v_clinic uuid := pg_catalog.gen_random_uuid();
  v_user   public.users%ROWTYPE;
  v_new    boolean := false;
BEGIN
  PERFORM app.require_platform_admin();
  IF v_code !~ '^[A-Z0-9]{2,10}$' OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 120
     OR v_email !~ v_email_re OR pg_catalog.length(v_email) > 254
     OR v_phone !~ '^\+?[0-9][0-9 -]{6,18}[0-9]$'
     OR pg_catalog.length(v_addr) NOT BETWEEN 1 AND 300 OR pg_catalog.length(v_city) NOT BETWEEN 1 AND 80
     OR pg_catalog.length(v_state) NOT BETWEEN 1 AND 80 OR v_pin !~ '^[1-9][0-9]{5}$'
     OR pg_catalog.length(v_branch) > 120
     OR pg_catalog.length(v_aname) NOT BETWEEN 2 AND 120 OR v_aemail !~ v_email_re OR pg_catalog.length(v_aemail) > 254 THEN
    RAISE EXCEPTION 'platform: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinics c WHERE pg_catalog.upper(c.code) = v_code) THEN
    RAISE EXCEPTION 'platform: DUPLICATE_CODE' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.clinics (id, code, name, email, phone, "addressLine", city, state, pincode, status, "updatedAt")
  VALUES (v_clinic, v_code, v_name, v_email, v_phone, v_addr, v_city, v_state, v_pin, 'ACTIVE', pg_catalog.now());
  INSERT INTO public.branches (id, "clinicId", code, name, "addressLine", city, phone, email, "isHeadOffice", status, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, 'MAIN', v_branch, v_addr, v_city, v_phone, v_email, true, 'ACTIVE', pg_catalog.now());

  SELECT * INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_aemail;
  IF v_user.id IS NULL THEN
    INSERT INTO public.users (id, email, name, status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_aemail, v_aname, 'INVITED', pg_catalog.now())
    RETURNING * INTO v_user;
    v_new := true;
  ELSIF v_user.status = 'DISABLED' THEN
    RAISE EXCEPTION 'platform: ADMIN_DISABLED' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "roleId", status, "updatedAt")
  SELECT pg_catalog.gen_random_uuid(), v_user.id, v_clinic, r.id, 'ACTIVE', pg_catalog.now() FROM public.roles r WHERE r.key = 'ADMINISTRATOR';

  PERFORM app.platform_audit('platform.clinic_created', v_clinic, pg_catalog.jsonb_build_object('code', v_code, 'adminIsNew', v_new));
  clinic_id := v_clinic;
  admin_user_id := v_user.id;
  admin_is_new := v_new;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION app.platform_create_clinic(text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_create_clinic(text, text, text, text, text, text, text, text, text, text, text) TO sehat_app;

-- Suspend (nobody at the clinic can sign in to it; it leaves the public website) or reactivate.
CREATE FUNCTION app.platform_set_clinic_status(p_clinic uuid, p_status text) RETURNS void
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
  PERFORM app.platform_audit(CASE p_status WHEN 'ACTIVE' THEN 'platform.clinic_activated' ELSE 'platform.clinic_suspended' END, p_clinic, NULL);
END
$$;
REVOKE ALL ON FUNCTION app.platform_set_clinic_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_set_clinic_status(uuid, text) TO sehat_app;

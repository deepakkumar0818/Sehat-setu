-- P6.4: patient self-registration + clinic-issued linking codes (approved
-- decision "Option A").
--
-- * Anyone may create a Supabase login and verify their email. That gives NO
--   access: the app has no users row for them until a code is redeemed, and
--   the portal needs a PATIENT membership AND a patients.userId link.
-- * After the clinic's identity-verification procedure, an Administrator or
--   Receptionist (new permission patient.portal_link) issues a code for ONE
--   patient record of THEIR clinic. The code is random (80 bits, Crockford
--   base32, shown once as XXXX-XXXX-XXXX-XXXX), expires after 72 hours, is
--   stored only as a SHA-256 hash, and is single-use. Issuing a new code
--   revokes the patient's previous one.
-- * Redemption (app.redeem_patient_link_code) runs for a signed-in Supabase
--   user with a confirmed email (the server passes the id and email from
--   supabase.auth.getUser(); the id must match the pinned transaction
--   context). In ONE transaction, with row locks, it: checks the per-account
--   attempt limits, finds the code by hash, creates or reuses the account,
--   adds an ACTIVE PATIENT membership, fills patients.userId only if it is
--   empty, and marks the code REDEEMED. The patient and clinic come only from
--   the code row — never from the request.
-- * Existing links are never replaced: a patient already linked, an account
--   already linked to any patient (patients.userId is unique), an inactive
--   portal membership, a disabled account, or a staff member of the same
--   clinic is refused ("NOT_ELIGIBLE") and the code stays usable for the clinic
--   to sort out.
-- * Failed redemptions are recorded (auth user id + time only, never the code)
--   and limited to 5 per 15 minutes and 10 per 24 hours per account. The
--   function RETURNS a result instead of raising, so the failure record commits.
-- * Audit: app.log_event rows carry ids, counts and reason codes only — never
--   the code, its hash or clinical data. Row triggers also audit the tables.
-- * The runtime role gets NO privileges on the two new tables; all access is
--   through the functions below, which re-check the caller from the pinned
--   session. Nothing existing is modified or dropped, except role_permissions
--   rows ADDED for the new key (postcondition-checked).

-- 1. Types and tables ---------------------------------------------------------
CREATE TYPE "PatientLinkCodeStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'REVOKED');

CREATE TABLE "patient_link_codes" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"         UUID NOT NULL,
  "patientId"        UUID NOT NULL,
  "codeHash"         TEXT NOT NULL,
  "status"           "PatientLinkCodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt"        TIMESTAMPTZ(6) NOT NULL,
  "issuedByUserId"   UUID NOT NULL,
  "redeemedAt"       TIMESTAMPTZ(6),
  "redeemedByUserId" UUID,
  "revokedAt"        TIMESTAMPTZ(6),
  "revokedByUserId"  UUID,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "patient_link_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_link_codes_clinicId_patientId_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "patients"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_link_codes_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_link_codes_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_link_codes_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_link_codes_hash_format" CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "patient_link_codes_expiry" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "patient_link_codes_state" CHECK (
       ("status" = 'ACTIVE'   AND "redeemedAt" IS NULL AND "redeemedByUserId" IS NULL AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL)
    OR ("status" = 'REDEEMED' AND "redeemedAt" IS NOT NULL AND "redeemedByUserId" IS NOT NULL AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL)
    OR ("status" = 'REVOKED'  AND "revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "redeemedAt" IS NULL AND "redeemedByUserId" IS NULL))
);
CREATE UNIQUE INDEX "patient_link_codes_codeHash_key" ON "patient_link_codes"("codeHash");
CREATE INDEX "patient_link_codes_clinicId_createdAt_idx" ON "patient_link_codes"("clinicId", "createdAt");
CREATE INDEX "patient_link_codes_patientId_status_idx" ON "patient_link_codes"("patientId", "status");
-- At most one usable code per patient (a new code revokes the previous one).
CREATE UNIQUE INDEX patient_link_codes_one_active ON patient_link_codes ("patientId") WHERE "status" = 'ACTIVE';

-- Redemption attempts, for the per-account limits. No code, hash, clinic or patient.
CREATE TABLE "patient_link_attempts" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "authUserId" TEXT NOT NULL,
  "succeeded"  BOOLEAN NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "patient_link_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_link_attempts_auth_format" CHECK (length("authUserId") BETWEEN 1 AND 128)
);
CREATE INDEX "patient_link_attempts_authUserId_createdAt_idx" ON "patient_link_attempts"("authUserId", "createdAt");

-- 2. Access: RLS on, NO table privileges for the runtime role (functions only).
--    The deny-all policies document that intent and keep the "every table has a
--    runtime policy" invariant (prisma/migrations.test.ts).
ALTER TABLE "patient_link_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_link_attempts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON patient_link_codes, patient_link_attempts FROM PUBLIC, anon, authenticated;
CREATE POLICY patient_link_codes_none ON patient_link_codes FOR SELECT TO sehat_app USING (false);
CREATE POLICY patient_link_attempts_none ON patient_link_attempts FOR SELECT TO sehat_app USING (false);

CREATE TRIGGER audit_patient_link_codes AFTER INSERT OR UPDATE OR DELETE ON patient_link_codes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- 3. Internal helpers (not granted to the runtime role) ------------------------
-- 16 Crockford base32 characters = 80 bits from gen_random_uuid() (pg_strong_random).
-- Bytes 6 and 8 of a v4 UUID carry fixed version/variant bits, so they are skipped.
CREATE FUNCTION app.new_patient_link_code() RETURNS text
  LANGUAGE plpgsql VOLATILE SET search_path = '' AS
$$
DECLARE
  c_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := pg_catalog.decode(
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex');
  v_out text := '';
BEGIN
  FOR i IN 0..31 LOOP
    CONTINUE WHEN i IN (6, 8, 22, 24);
    v_out := v_out || pg_catalog.substr(c_alpha, (pg_catalog.get_byte(v_bytes, i) % 32) + 1, 1);
    EXIT WHEN pg_catalog.length(v_out) = 16;
  END LOOP;
  RETURN v_out;
END
$$;
REVOKE ALL ON FUNCTION app.new_patient_link_code() FROM PUBLIC;

-- Normalises what a person typed: case, spaces and dashes ignored; O->0, I/L->1.
-- NULL when it can't be a code (so it is never looked up).
CREATE FUNCTION app.normalise_patient_link_code(p text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$
  SELECT CASE WHEN pg_catalog.length(coalesce(p, '')) > 64 THEN NULL ELSE (
    SELECT CASE WHEN n ~ '^[0-9A-HJKMNP-TV-Z]{16}$' THEN n END
      FROM (SELECT pg_catalog.translate(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p, ''), '[[:space:]-]', '', 'g')), 'OIL', '011') AS n) x)
  END
$$;
REVOKE ALL ON FUNCTION app.normalise_patient_link_code(text) FROM PUBLIC;

CREATE FUNCTION app.patient_link_code_hash(p_normalised text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('sehat-setu:patient-link:' || p_normalised, 'UTF8')), 'hex') $$;
REVOKE ALL ON FUNCTION app.patient_link_code_hash(text) FROM PUBLIC;

CREATE FUNCTION app.require_patient_linker() RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL
     OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['patient.portal_link']) THEN
    RAISE EXCEPTION 'patient link: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.require_patient_linker() FROM PUBLIC;

-- 4. Staff: issue / revoke / status ---------------------------------------------
-- Returns the code ONCE (formatted XXXX-XXXX-XXXX-XXXX). Only its hash is stored.
CREATE FUNCTION app.issue_patient_link_code(p_patient_id uuid, p_identity_verified boolean)
  RETURNS TABLE (code text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
#variable_conflict use_column
DECLARE
  v_clinic     uuid := app.current_clinic_id();
  v_patient    public.patients%ROWTYPE;
  v_code       text;
  v_id         uuid;
  v_expires    timestamptz := pg_catalog.now() + interval '72 hours';
  v_superseded integer;
BEGIN
  PERFORM app.require_patient_linker();
  -- The staff member confirms the clinic's identity-verification procedure was followed.
  IF p_identity_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'patient link: IDENTITY_NOT_CONFIRMED' USING ERRCODE = '22023';
  END IF;
  -- Another clinic's patient (or none) is indistinguishable from a missing one.
  SELECT * INTO v_patient FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = v_clinic FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient link: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_patient.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'patient link: PATIENT_INACTIVE' USING ERRCODE = '55000';
  END IF;
  IF v_patient."userId" IS NOT NULL THEN
    RAISE EXCEPTION 'patient link: ALREADY_LINKED' USING ERRCODE = '23505';
  END IF;
  -- Abuse guards: 60 codes per clinic per hour; 5 per patient per 24 hours.
  IF (SELECT pg_catalog.count(*) FROM public.patient_link_codes c
       WHERE c."clinicId" = v_clinic AND c."createdAt" > pg_catalog.now() - interval '1 hour') >= 60
     OR (SELECT pg_catalog.count(*) FROM public.patient_link_codes c
       WHERE c."patientId" = v_patient.id AND c."createdAt" > pg_catalog.now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'patient link: RATE_LIMITED' USING ERRCODE = '55000';
  END IF;

  UPDATE public.patient_link_codes c
     SET status = 'REVOKED', "revokedAt" = pg_catalog.now(), "revokedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now()
   WHERE c."patientId" = v_patient.id AND c.status = 'ACTIVE';
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  v_code := app.new_patient_link_code();
  INSERT INTO public.patient_link_codes (id, "clinicId", "patientId", "codeHash", "expiresAt", "issuedByUserId", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, v_patient.id, app.patient_link_code_hash(v_code), v_expires, app.current_user_id(), pg_catalog.now())
  RETURNING id INTO v_id;

  PERFORM app.log_event('patient.link_code_issued', 'SUCCESS', 'patients', v_patient.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('codeId', v_id, 'expiresAt', v_expires, 'superseded', v_superseded, 'identityVerified', true));
  RETURN QUERY SELECT pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4) || '-' ||
                      pg_catalog.substr(v_code, 9, 4) || '-' || pg_catalog.substr(v_code, 13, 4), v_expires;
END
$$;

-- Revokes the patient's usable code, if any. Returns whether one was revoked.
CREATE FUNCTION app.revoke_patient_link_code(p_patient_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_id     uuid;
BEGIN
  PERFORM app.require_patient_linker();
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = v_clinic) THEN
    RAISE EXCEPTION 'patient link: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.patient_link_codes c
     SET status = 'REVOKED', "revokedAt" = pg_catalog.now(), "revokedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now()
   WHERE c."patientId" = p_patient_id AND c."clinicId" = v_clinic AND c.status = 'ACTIVE'
  RETURNING c.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM app.log_event('patient.link_code_revoked', 'SUCCESS', 'patients', p_patient_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('codeId', v_id));
  RETURN true;
END
$$;

-- Whether the patient has a portal account linked (never WHICH account), and
-- the usable code's issue/expiry times (never the code or its hash).
CREATE FUNCTION app.patient_portal_link_status(p_patient_id uuid)
  RETURNS TABLE (linked boolean, code_issued_at timestamptz, code_expires_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
#variable_conflict use_column
BEGIN
  PERFORM app.require_patient_linker();
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient_id AND p."clinicId" = app.current_clinic_id()) THEN
    RAISE EXCEPTION 'patient link: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT p."userId" IS NOT NULL, c."createdAt", c."expiresAt"
      FROM public.patients p
      LEFT JOIN public.patient_link_codes c
        ON c."patientId" = p.id AND c.status = 'ACTIVE' AND c."expiresAt" > pg_catalog.now()
     WHERE p.id = p_patient_id;
END
$$;

-- 5. Patient: redeem ----------------------------------------------------------
-- result: LINKED | ALREADY_LINKED (repeat by the same account) | INVALID (unknown,
-- malformed, expired, used or revoked — deliberately one answer) | NOT_ELIGIBLE
-- (valid code, but linking would replace or mix an existing link) | RATE_LIMITED.
CREATE FUNCTION app.redeem_patient_link_code(p_code text, p_verified_email text)
  RETURNS TABLE (result text, clinic_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
#variable_conflict use_column
DECLARE
  v_auth       text := app.current_auth_user_id();
  v_email      text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_verified_email, '')));
  v_norm       text;
  v_code       public.patient_link_codes%ROWTYPE;
  v_patient    public.patients%ROWTYPE;
  v_user       public.users%ROWTYPE;
  v_role       uuid;
  v_member     public.clinic_memberships%ROWTYPE;
  v_reason     text;
  v_new_user   boolean := false;
  v_new_member boolean := false;
BEGIN
  IF v_auth IS NULL OR pg_catalog.length(v_auth) > 128 THEN
    RAISE EXCEPTION 'patient link: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  -- The server passes the Supabase-confirmed email (getUser(), email_confirmed_at set); never the browser.
  IF pg_catalog.length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'patient link: EMAIL_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;

  -- One redemption decision per account at a time (makes the limits exact).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:patient-link:' || v_auth, 0));
  IF (SELECT pg_catalog.count(*) FROM public.patient_link_attempts a
       WHERE a."authUserId" = v_auth AND NOT a.succeeded AND a."createdAt" > pg_catalog.now() - interval '15 minutes') >= 5
     OR (SELECT pg_catalog.count(*) FROM public.patient_link_attempts a
       WHERE a."authUserId" = v_auth AND NOT a.succeeded AND a."createdAt" > pg_catalog.now() - interval '24 hours') >= 10 THEN
    RETURN QUERY SELECT 'RATE_LIMITED'::text, NULL::uuid;
    RETURN;
  END IF;
  DELETE FROM public.patient_link_attempts a WHERE a."authUserId" = v_auth AND a."createdAt" < pg_catalog.now() - interval '30 days';

  v_norm := app.normalise_patient_link_code(p_code);
  IF v_norm IS NOT NULL THEN
    SELECT * INTO v_code FROM public.patient_link_codes c WHERE c."codeHash" = app.patient_link_code_hash(v_norm) FOR UPDATE;
  END IF;

  IF v_code.id IS NULL THEN
    v_reason := CASE WHEN v_norm IS NULL THEN 'malformed' ELSE 'unknown' END;
  ELSIF v_code.status = 'REDEEMED' THEN
    -- A repeat by the account that redeemed it (double submit) is not an error.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_code."redeemedByUserId" AND u."authProviderId" = v_auth)
       AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_code."patientId" AND p."userId" = v_code."redeemedByUserId") THEN
      RETURN QUERY SELECT 'ALREADY_LINKED'::text, v_code."clinicId";
      RETURN;
    END IF;
    v_reason := 'used';
  ELSIF v_code.status = 'REVOKED' THEN
    v_reason := 'revoked';
  ELSIF v_code."expiresAt" <= pg_catalog.now() THEN
    v_reason := 'expired';
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.patient_link_attempts ("authUserId", succeeded) VALUES (v_auth, false);
    -- No clinic: an unknown code belongs to no one (operator-visible only).
    PERFORM pg_catalog.set_config('app.clinic_id', '', true);
    PERFORM app.log_event('patient.link_code_redeem_failed', 'FAILURE', NULL, NULL, v_reason, NULL, NULL, NULL);
    RETURN QUERY SELECT 'INVALID'::text, NULL::uuid;
    RETURN;
  END IF;

  -- From here on the clinic and patient come ONLY from the code row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:invite:' || v_email, 0));
  SELECT * INTO v_patient FROM public.patients p WHERE p.id = v_code."patientId" AND p."clinicId" = v_code."clinicId" FOR UPDATE;
  SELECT * INTO v_user FROM public.users u WHERE u."authProviderId" = v_auth FOR UPDATE;
  IF v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_email FOR UPDATE;
    IF v_user.id IS NOT NULL AND NOT (v_user."authProviderId" IS NULL AND v_user.status = 'INVITED') THEN
      v_reason := 'email_in_use';
    END IF;
  END IF;
  SELECT r.id INTO v_role FROM public.roles r WHERE r.key = 'PATIENT';

  IF v_reason IS NOT NULL THEN
    NULL;
  ELSIF v_patient.id IS NULL OR v_patient.status <> 'ACTIVE' THEN
    v_reason := 'patient_inactive';
  ELSIF NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = v_code."clinicId" AND c.status = 'ACTIVE') THEN
    v_reason := 'clinic_inactive';
  ELSIF v_role IS NULL THEN
    v_reason := 'no_patient_role';
  ELSIF v_user.id IS NOT NULL AND v_user."authProviderId" IS NOT NULL AND v_user.status <> 'ACTIVE' THEN
    v_reason := 'account_disabled';
  ELSIF v_user.id IS NOT NULL AND v_user.status = 'DISABLED' THEN
    v_reason := 'account_disabled';
  ELSIF v_user.id IS NOT NULL AND pg_catalog.lower(v_user.email) <> v_email THEN
    v_reason := 'email_mismatch';
  ELSIF v_patient."userId" IS NOT NULL THEN
    v_reason := 'patient_already_linked';
  ELSIF v_user.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_user.id) THEN
    v_reason := 'account_already_linked';
  ELSIF v_user.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
           WHERE m."userId" = v_user.id AND m."clinicId" = v_code."clinicId" AND r.key <> 'PATIENT') THEN
    v_reason := 'staff_account';
  END IF;
  IF v_reason IS NULL AND v_user.id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.clinic_memberships m
     WHERE m."userId" = v_user.id AND m."clinicId" = v_code."clinicId" AND m."roleId" = v_role FOR UPDATE;
    IF v_member.id IS NOT NULL AND v_member.status <> 'ACTIVE' THEN
      v_reason := 'membership_inactive'; -- the clinic switched this portal access off: never silently re-enabled
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.patient_link_attempts ("authUserId", succeeded) VALUES (v_auth, false);
    PERFORM pg_catalog.set_config('app.clinic_id', v_code."clinicId"::text, true);
    PERFORM pg_catalog.set_config('app.user_id', coalesce(v_user.id::text, ''), true);
    PERFORM app.log_event('patient.link_code_redeem_failed', 'DENIED', 'patients', v_code."patientId"::text, v_reason, NULL, NULL,
      pg_catalog.jsonb_build_object('codeId', v_code.id));
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Account: reuse, link an INVITED row with this email, or create one. Created
  -- without a clinic in context, so this clinic's audit trail can't tell whether
  -- the person already had an account elsewhere.
  PERFORM pg_catalog.set_config('app.clinic_id', '', true);
  IF v_user.id IS NULL THEN
    INSERT INTO public.users (id, email, name, status, "authProviderId", "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_email, v_patient.name, 'ACTIVE', v_auth, pg_catalog.now())
    RETURNING * INTO v_user;
    v_new_user := true;
  ELSIF v_user."authProviderId" IS NULL THEN
    UPDATE public.users SET "authProviderId" = v_auth, status = 'ACTIVE', "updatedAt" = pg_catalog.now()
     WHERE id = v_user.id AND "authProviderId" IS NULL AND status = 'INVITED'
    RETURNING * INTO v_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'patient link: CONFLICT' USING ERRCODE = '40001'; -- unreachable under the row lock
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.user_id', v_user.id::text, true);
  PERFORM pg_catalog.set_config('app.clinic_id', v_code."clinicId"::text, true);
  IF v_member.id IS NULL THEN
    INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_code."clinicId", NULL, v_role, 'ACTIVE', pg_catalog.now());
    v_new_member := true;
  END IF;

  UPDATE public.patients SET "userId" = v_user.id, "updatedAt" = pg_catalog.now()
   WHERE id = v_patient.id AND "clinicId" = v_code."clinicId" AND "userId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient link: CONFLICT' USING ERRCODE = '40001'; -- unreachable under the row lock; never overwrite
  END IF;
  UPDATE public.patient_link_codes
     SET status = 'REDEEMED', "redeemedAt" = pg_catalog.now(), "redeemedByUserId" = v_user.id, "updatedAt" = pg_catalog.now()
   WHERE id = v_code.id AND status = 'ACTIVE';

  INSERT INTO public.patient_link_attempts ("authUserId", succeeded) VALUES (v_auth, true);
  PERFORM app.log_event('patient.portal_linked', 'SUCCESS', 'patients', v_patient.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('codeId', v_code.id, 'accountCreated', v_new_user, 'membershipCreated', v_new_member));
  RETURN QUERY SELECT 'LINKED'::text, v_code."clinicId";
END
$$;

REVOKE ALL ON FUNCTION app.issue_patient_link_code(uuid, boolean), app.revoke_patient_link_code(uuid),
  app.patient_portal_link_status(uuid), app.redeem_patient_link_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_patient_link_code(uuid, boolean), app.revoke_patient_link_code(uuid),
  app.patient_portal_link_status(uuid), app.redeem_patient_link_code(text, text) TO sehat_app;

-- 6. Permission (approved: Administrator and Receptionist) ----------------------
--    Same pattern as 20261021000000: deterministic id (demoId('permission:<key>')),
--    names identical to src/data/permission-catalog.ts, postcondition-checked.
DO $$
DECLARE
  r record;
  c_id   constant uuid := '3a147148-b2fe-59c3-b89d-5063aeb05fc6';
  c_key  constant text := 'patient.portal_link';
  c_name constant text := 'Issue patient portal linking codes';
  c_mod  constant text := 'patient';
  c_desc constant text := 'Issue or revoke a one-time code that links a patient''s self-registered portal account to their record, after verifying their identity.';
  c_grants constant jsonb := '{"patient.portal_link": ["ADMINISTRATOR", "RECEPTIONIST"]}';
BEGIN
  SELECT id, key, name, module, description INTO r FROM public.permissions WHERE key = c_key;
  IF FOUND THEN
    IF r.id <> c_id OR r.name IS DISTINCT FROM c_name OR r.module IS DISTINCT FROM c_mod OR r.description IS DISTINCT FROM c_desc THEN
      RAISE EXCEPTION 'permission % already exists with unexpected values; refusing to continue', c_key;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.permissions WHERE id = c_id) THEN
      RAISE EXCEPTION 'permission id % is already used by another permission', c_id;
    END IF;
    INSERT INTO public.permissions (id, key, name, module, description) VALUES (c_id, c_key, c_name, c_mod, c_desc);
  END IF;

  IF EXISTS (SELECT 1 FROM public.roles) AND (SELECT pg_catalog.count(*) FROM public.roles WHERE key IN ('ADMINISTRATOR', 'RECEPTIONIST')) <> 2 THEN
    RAISE EXCEPTION 'roles exist but ADMINISTRATOR or RECEPTIONIST is missing; refusing to continue';
  END IF;
  INSERT INTO public.role_permissions ("roleId", "permissionId")
  SELECT ro.id, p.id
    FROM jsonb_each(c_grants) g
    CROSS JOIN LATERAL jsonb_array_elements_text(g.value) AS rk(role_key)
    JOIN public.permissions p ON p.key = g.key
    JOIN public.roles ro ON ro.key::text = rk.role_key
  ON CONFLICT DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.roles)
     AND (SELECT array_agg(ro.key::text ORDER BY ro.key::text) FROM public.role_permissions rp
            JOIN public.roles ro ON ro.id = rp."roleId" JOIN public.permissions p ON p.id = rp."permissionId" WHERE p.key = c_key)
         IS DISTINCT FROM ARRAY['ADMINISTRATOR', 'RECEPTIONIST'] THEN
    RAISE EXCEPTION 'permission % is not held by exactly ADMINISTRATOR and RECEPTIONIST; refusing to continue', c_key;
  END IF;
END
$$;

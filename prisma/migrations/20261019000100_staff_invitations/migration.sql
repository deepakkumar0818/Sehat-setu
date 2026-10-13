-- P5b: administrator-only staff and doctor invitations (approved design).
-- * Invitable: DOCTOR, CLINIC_MANAGER, RECEPTIONIST, NURSE. Never ADMINISTRATOR
--   or PATIENT. Enforced here and in the API (src/server/data/invitation-rules.ts).
-- * A branch is required for every role; it must be active, in the inviter's
--   clinic and inside the inviter's own branch scope. A doctor gets exactly
--   that one branch (more can be added later by an operator).
-- * The runtime role gets SELECT only; every write goes through the SECURITY
--   DEFINER functions below, which re-check the caller from the pinned session.
-- * Membership (and, for doctors, the doctor profile + branch link) is created
--   ONLY by app.accept_staff_invitation, from the values stored on the
--   invitation, for the signed-in owner of the invited account whose
--   Supabase-verified email matches. Nothing is created before acceptance.
-- * Limits (enforced here, so they hold across server instances): 7-day expiry,
--   resend cooldown 2 minutes, at most 10 sends per invitation (each resend
--   extends expiry by 7 days), at most 50 new invitations per clinic per hour.
-- * Error messages are 'staff invitation: <CODE>' so the server maps them to
--   API errors without parsing prose.
-- * Nothing existing is modified or dropped. One index is added to users after
--   verifying there are no case-insensitive duplicate emails (never resolved
--   automatically: the migration aborts instead).

CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "InvitationDelivery" AS ENUM ('NOT_SENT', 'SENDING', 'SENT', 'FAILED');

-- 1. One account per email regardless of case (prevents duplicate users).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users GROUP BY pg_catalog.lower(email) HAVING pg_catalog.count(*) > 1) THEN
    RAISE EXCEPTION 'users contains emails that differ only by case; resolve them before applying this migration';
  END IF;
END
$$;
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- 2. Tables.
CREATE TABLE "staff_invitations" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "clinicId"        UUID NOT NULL,
  "branchId"        UUID NOT NULL,
  "roleId"          UUID NOT NULL,
  "userId"          UUID NOT NULL,
  "email"           TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"       TIMESTAMPTZ(6) NOT NULL,
  "deliveryStatus"  "InvitationDelivery" NOT NULL DEFAULT 'NOT_SENT',
  "deliveryError"   TEXT,
  "sendAttempts"    INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"   TIMESTAMPTZ(6),
  "lastSentAt"      TIMESTAMPTZ(6),
  "invitedByUserId" UUID NOT NULL,
  "acceptedAt"      TIMESTAMPTZ(6),
  "membershipId"    UUID,
  "revokedAt"       TIMESTAMPTZ(6),
  "revokedByUserId" UUID,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_invitations_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_clinicId_branchId_fkey" FOREIGN KEY ("clinicId", "branchId") REFERENCES "branches"("clinicId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "clinic_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitations_email_normalised" CHECK (
    "email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT "staff_invitations_name_valid" CHECK (length("name") BETWEEN 2 AND 120 AND "name" !~ '[[:cntrl:]]'),
  CONSTRAINT "staff_invitations_error_code" CHECK ("deliveryError" IS NULL OR "deliveryError" ~ '^[a-z_]{1,40}$'),
  CONSTRAINT "staff_invitations_attempts" CHECK ("sendAttempts" BETWEEN 0 AND 10),
  CONSTRAINT "staff_invitations_state" CHECK (
       ("status" = 'PENDING'  AND "acceptedAt" IS NULL AND "membershipId" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "membershipId" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED'  AND "revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "acceptedAt" IS NULL))
);
CREATE UNIQUE INDEX staff_invitations_one_pending ON staff_invitations ("clinicId", "email") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "staff_invitations_membershipId_key" ON staff_invitations ("membershipId");
CREATE INDEX "staff_invitations_clinicId_status_createdAt_idx" ON staff_invitations ("clinicId", "status", "createdAt");
CREATE INDEX "staff_invitations_userId_status_idx" ON staff_invitations ("userId", "status");

-- Doctor profile details, held until acceptance (professional data only; no patient data).
CREATE TABLE "staff_invitation_doctor_details" (
  "invitationId"         UUID NOT NULL,
  "clinicId"             UUID NOT NULL,
  "specialtyId"          UUID NOT NULL,
  "qualifications"       TEXT NOT NULL,
  "registrationNumber"   TEXT NOT NULL,
  "experienceYears"      INTEGER NOT NULL,
  "consultationFeePaise" INTEGER NOT NULL,
  "onlineConsultation"   BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "staff_invitation_doctor_details_pkey" PRIMARY KEY ("invitationId"),
  CONSTRAINT "staff_invitation_doctor_details_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "staff_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitation_doctor_details_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitation_doctor_details_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_invitation_doctor_details_valid" CHECK (
        length("qualifications") BETWEEN 2 AND 200 AND "qualifications" !~ '[[:cntrl:]]'
    AND length("registrationNumber") BETWEEN 3 AND 40 AND "registrationNumber" !~ '[[:cntrl:]]'
    AND "experienceYears" BETWEEN 0 AND 70
    AND "consultationFeePaise" BETWEEN 0 AND 10000000)
);
CREATE INDEX "staff_invitation_doctor_details_clinic_reg_idx" ON staff_invitation_doctor_details ("clinicId", lower("registrationNumber"));

-- 3. Read access: Administrators (user.create / user.view) and Clinic Managers
--    (staff.view), within their branch scope. No write privileges at all.
ALTER TABLE "staff_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_invitation_doctor_details" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON staff_invitations, staff_invitation_doctor_details TO sehat_app;
CREATE POLICY staff_invitations_read ON staff_invitations FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND app.branch_visible("branchId")
  AND (SELECT app.staff_can(ARRAY['user.create', 'user.view', 'staff.view']))
);
-- Visible exactly when the parent invitation is (the EXISTS is filtered by staff_invitations_read).
CREATE POLICY staff_invitation_doctor_details_read ON staff_invitation_doctor_details FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND EXISTS (SELECT 1 FROM staff_invitations i WHERE i.id = "invitationId")
);

-- 4. Internal helpers (not granted to the runtime role).
CREATE FUNCTION app.mask_email(p text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = '' AS
$$ SELECT pg_catalog.left(p, 1) || '***' || pg_catalog.substr(p, pg_catalog.strpos(p, '@')) $$;
REVOKE ALL ON FUNCTION app.mask_email(text) FROM PUBLIC;

CREATE FUNCTION app.require_inviter() RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL
     OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['user.create']) THEN
    RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.require_inviter() FROM PUBLIC;

-- 5. Create (claims the first send attempt in the same transaction).
CREATE FUNCTION app.create_staff_invitation(
  p_email text, p_name text, p_role_key text, p_branch_id uuid,
  p_specialty_id uuid DEFAULT NULL, p_qualifications text DEFAULT NULL, p_registration_number text DEFAULT NULL,
  p_experience_years integer DEFAULT NULL, p_consultation_fee_paise integer DEFAULT NULL, p_online_consultation boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  c_roles  constant text[] := ARRAY['DOCTOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE'];
  v_email  text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name   text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_qual   text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_qualifications, ''), '\s+', ' ', 'g'));
  v_reg    text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_registration_number, ''), '\s+', ' ', 'g'));
  v_clinic uuid := app.current_clinic_id();
  v_role   uuid;
  v_user   uuid;
  v_id     uuid;
  v_kind   text;
BEGIN
  PERFORM app.require_inviter();
  IF p_role_key IS NULL OR NOT (p_role_key = ANY (c_roles)) THEN
    RAISE EXCEPTION 'staff invitation: ROLE_NOT_INVITABLE' USING ERRCODE = '22023';
  END IF;
  SELECT r.id INTO v_role FROM public.roles r WHERE r.key::text = p_role_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff invitation: ROLE_NOT_INVITABLE' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'staff invitation: INVALID_EMAIL' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'staff invitation: INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  -- Branch: required, active, in this clinic, inside the inviter's own scope.
  IF p_branch_id IS NULL OR NOT app.branch_visible(p_branch_id) OR NOT EXISTS (
       SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b."clinicId" = v_clinic AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'staff invitation: INVALID_BRANCH' USING ERRCODE = '22023';
  END IF;

  IF p_role_key = 'DOCTOR' THEN
    IF NOT app.staff_can(ARRAY['doctor.manage']) THEN
      RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
    END IF;
    IF p_specialty_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.specialties s WHERE s.id = p_specialty_id) THEN
      RAISE EXCEPTION 'staff invitation: INVALID_SPECIALTY' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(v_qual) NOT BETWEEN 2 AND 200 OR v_qual ~ '[[:cntrl:]]'
       OR pg_catalog.length(v_reg) NOT BETWEEN 3 AND 40 OR v_reg ~ '[[:cntrl:]]'
       OR p_experience_years IS NULL OR p_experience_years NOT BETWEEN 0 AND 70
       OR p_consultation_fee_paise IS NULL OR p_consultation_fee_paise NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION 'staff invitation: INVALID_DOCTOR_DETAILS' USING ERRCODE = '22023';
    END IF;
  ELSIF p_specialty_id IS NOT NULL OR p_qualifications IS NOT NULL OR p_registration_number IS NOT NULL
        OR p_experience_years IS NOT NULL OR p_consultation_fee_paise IS NOT NULL OR p_online_consultation IS NOT NULL THEN
    RAISE EXCEPTION 'staff invitation: DOCTOR_DETAILS_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  -- Abuse guard: at most 50 new invitations per clinic per hour.
  IF (SELECT pg_catalog.count(*) FROM public.staff_invitations i
      WHERE i."clinicId" = v_clinic AND i."createdAt" > pg_catalog.now() - interval '1 hour') >= 50 THEN
    RAISE EXCEPTION 'staff invitation: RATE_LIMITED' USING ERRCODE = '55000';
  END IF;

  -- One decision per email at a time across all clinics (covers user creation).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:invite:' || v_email, 0));

  IF p_role_key = 'DOCTOR' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sehat:docreg:' || v_clinic::text || ':' || pg_catalog.lower(v_reg), 0));
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d
               WHERE d."clinicId" = v_clinic AND pg_catalog.lower(d."registrationNumber") = pg_catalog.lower(v_reg))
       OR EXISTS (SELECT 1 FROM public.staff_invitation_doctor_details x JOIN public.staff_invitations i ON i.id = x."invitationId"
                  WHERE x."clinicId" = v_clinic AND pg_catalog.lower(x."registrationNumber") = pg_catalog.lower(v_reg) AND i.status = 'PENDING') THEN
      RAISE EXCEPTION 'staff invitation: REGISTRATION_IN_USE' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT u.id INTO v_user FROM public.users u WHERE pg_catalog.lower(u.email) = v_email;
  -- Same-clinic facts only (this clinic's admins can already see its memberships).
  -- A patient of this clinic is never converted into staff.
  IF v_user IS NOT NULL THEN
    SELECT CASE WHEN pg_catalog.bool_or(r.key = 'PATIENT') THEN 'ALREADY_PATIENT' ELSE 'ALREADY_MEMBER' END INTO v_kind
    FROM public.clinic_memberships m JOIN public.roles r ON r.id = m."roleId"
    WHERE m."userId" = v_user AND m."clinicId" = v_clinic;
    IF v_kind IS NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_user AND p."clinicId" = v_clinic) THEN
      v_kind := 'ALREADY_PATIENT';
    END IF;
    IF v_kind IS NOT NULL THEN
      RAISE EXCEPTION 'staff invitation: %', v_kind USING ERRCODE = '23505';
    END IF;
  END IF;
  SELECT i.id INTO v_id FROM public.staff_invitations i
   WHERE i."clinicId" = v_clinic AND i.email = v_email AND i.status = 'PENDING';
  IF FOUND THEN
    RAISE EXCEPTION 'staff invitation: ALREADY_INVITED %', v_id USING ERRCODE = '23505';
  END IF;

  IF v_user IS NULL THEN
    -- New person: an INVITED row for first-sign-in linking (app.link_auth_user).
    -- Audited WITHOUT a clinic, so this clinic's audit trail can't reveal whether
    -- the email already had an account elsewhere (operator-visible only).
    PERFORM pg_catalog.set_config('app.clinic_id', '', true);
    INSERT INTO public.users (id, email, name, status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_email, v_name, 'INVITED', pg_catalog.now())
    RETURNING id INTO v_user;
    PERFORM pg_catalog.set_config('app.clinic_id', v_clinic::text, true);
  END IF;

  INSERT INTO public.staff_invitations (id, "clinicId", "branchId", "roleId", "userId", email, name, "expiresAt",
                                        "deliveryStatus", "sendAttempts", "lastAttemptAt", "invitedByUserId", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_clinic, p_branch_id, v_role, v_user, v_email, v_name, pg_catalog.now() + interval '7 days',
          'SENDING', 1, pg_catalog.now(), app.current_user_id(), pg_catalog.now())
  RETURNING id INTO v_id;

  IF p_role_key = 'DOCTOR' THEN
    INSERT INTO public.staff_invitation_doctor_details ("invitationId", "clinicId", "specialtyId", qualifications, "registrationNumber",
                                                        "experienceYears", "consultationFeePaise", "onlineConsultation")
    VALUES (v_id, v_clinic, p_specialty_id, v_qual, v_reg, p_experience_years, p_consultation_fee_paise, coalesce(p_online_consultation, false));
  END IF;

  PERFORM app.log_event('staff.invitation_created', 'SUCCESS', 'staff_invitations', v_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('role', p_role_key, 'branchId', p_branch_id, 'email', app.mask_email(v_email)));
  RETURN v_id;
END
$$;

-- 6. Resend: claims a send attempt (row lock + cooldown => a double click sends once) and extends expiry.
--    Returns the address to send to.
CREATE FUNCTION app.resend_staff_invitation(p_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
BEGIN
  PERFORM app.require_inviter();
  SELECT * INTO v_inv FROM public.staff_invitations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_inv."clinicId" <> app.current_clinic_id() OR NOT app.branch_visible(v_inv."branchId") THEN
    RAISE EXCEPTION 'staff invitation: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.status <> 'PENDING' THEN
    RAISE EXCEPTION 'staff invitation: NOT_PENDING' USING ERRCODE = '55000';
  END IF;
  IF v_inv."lastAttemptAt" > pg_catalog.now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'staff invitation: TOO_SOON' USING ERRCODE = '55000';
  END IF;
  IF v_inv."sendAttempts" >= 10 THEN
    RAISE EXCEPTION 'staff invitation: TOO_MANY_ATTEMPTS' USING ERRCODE = '55000';
  END IF;
  UPDATE public.staff_invitations
     SET "deliveryStatus" = 'SENDING', "deliveryError" = NULL, "sendAttempts" = "sendAttempts" + 1,
         "lastAttemptAt" = pg_catalog.now(), "expiresAt" = pg_catalog.now() + interval '7 days', "updatedAt" = pg_catalog.now()
   WHERE id = p_id;
  PERFORM app.log_event('staff.invitation_resent', 'SUCCESS', 'staff_invitations', p_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('attempt', v_inv."sendAttempts" + 1));
  RETURN v_inv.email;
END
$$;

-- 7. Record the outcome of a send attempt (after the network call, in a separate transaction).
CREATE FUNCTION app.record_invitation_delivery(p_id uuid, p_sent boolean, p_error text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_inv   public.staff_invitations%ROWTYPE;
  v_error text := CASE WHEN p_error ~ '^[a-z_]{1,40}$' THEN p_error ELSE 'unknown' END;
BEGIN
  PERFORM app.require_inviter();
  SELECT * INTO v_inv FROM public.staff_invitations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_inv."clinicId" <> app.current_clinic_id() OR NOT app.branch_visible(v_inv."branchId") THEN
    RAISE EXCEPTION 'staff invitation: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  -- Revoked/accepted meanwhile, or a stale result: keep the current state.
  IF v_inv.status <> 'PENDING' OR v_inv."deliveryStatus" <> 'SENDING' THEN
    RETURN;
  END IF;
  IF p_sent THEN
    UPDATE public.staff_invitations SET "deliveryStatus" = 'SENT', "deliveryError" = NULL,
           "lastSentAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now() WHERE id = p_id;
  ELSE
    UPDATE public.staff_invitations SET "deliveryStatus" = 'FAILED', "deliveryError" = v_error,
           "updatedAt" = pg_catalog.now() WHERE id = p_id;
    PERFORM app.log_event('staff.invitation_delivery_failed', 'FAILURE', 'staff_invitations', p_id::text, v_error);
  END IF;
END
$$;

-- 8. Revoke (idempotent for an already-revoked invitation).
CREATE FUNCTION app.revoke_staff_invitation(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
BEGIN
  PERFORM app.require_inviter();
  SELECT * INTO v_inv FROM public.staff_invitations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_inv."clinicId" <> app.current_clinic_id() OR NOT app.branch_visible(v_inv."branchId") THEN
    RAISE EXCEPTION 'staff invitation: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_inv.status = 'REVOKED' THEN
    RETURN;
  END IF;
  IF v_inv.status = 'ACCEPTED' THEN
    RAISE EXCEPTION 'staff invitation: ALREADY_ACCEPTED' USING ERRCODE = '55000';
  END IF;
  UPDATE public.staff_invitations SET status = 'REVOKED', "revokedAt" = pg_catalog.now(),
         "revokedByUserId" = app.current_user_id(), "updatedAt" = pg_catalog.now() WHERE id = p_id;
  PERFORM app.log_event('staff.invitation_revoked', 'SUCCESS', 'staff_invitations', p_id::text);
END
$$;

-- 9. The invitee's own pending invitations (identity-only session: auth + user id
--    pinned, no clinic). p_verified_email comes from supabase.auth.getUser() on
--    the server (confirmed emails only), never from the browser.
CREATE FUNCTION app.my_staff_invitations(p_verified_email text)
RETURNS TABLE (id uuid, clinic_name text, branch_name text, role_key text, expires_at timestamptz, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$
  SELECT i.id, c.name, b.name, r.key::text, i."expiresAt", i."expiresAt" <= pg_catalog.now()
  FROM public.staff_invitations i
  JOIN public.users u    ON u.id = i."userId"
  JOIN public.clinics c  ON c.id = i."clinicId"
  JOIN public.branches b ON b.id = i."branchId"
  JOIN public.roles r    ON r.id = i."roleId"
  WHERE i."userId" = app.current_user_id()
    AND u."authProviderId" = app.current_auth_user_id()
    AND u.status = 'ACTIVE'
    AND i.email = pg_catalog.lower(u.email)
    AND i.email = pg_catalog.lower(pg_catalog.btrim(p_verified_email))
    AND i.status = 'PENDING' AND c.status = 'ACTIVE'
  ORDER BY i."createdAt"
$$;

-- 10. Accept: the only way an invitation becomes a membership (and doctor profile).
CREATE FUNCTION app.accept_staff_invitation(p_id uuid, p_verified_email text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_user       public.users%ROWTYPE;
  v_inv        public.staff_invitations%ROWTYPE;
  v_doc        public.staff_invitation_doctor_details%ROWTYPE;
  v_role       text;
  v_membership uuid;
  v_doctor     uuid;
BEGIN
  SELECT * INTO v_user FROM public.users u
   WHERE u.id = app.current_user_id() AND u."authProviderId" = app.current_auth_user_id();
  IF NOT FOUND OR app.current_auth_user_id() IS NULL OR v_user.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.staff_invitations i WHERE i.id = p_id FOR UPDATE;
  -- Someone else's invitation is indistinguishable from a missing one.
  IF NOT FOUND OR v_inv."userId" <> v_user.id OR v_inv.email <> pg_catalog.lower(v_user.email) THEN
    RAISE EXCEPTION 'staff invitation: NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  -- The Supabase-verified email (passed by the server from getUser(), never the client) must match.
  IF p_verified_email IS NULL OR pg_catalog.lower(pg_catalog.btrim(p_verified_email)) <> v_inv.email THEN
    RAISE EXCEPTION 'staff invitation: EMAIL_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status = 'ACCEPTED' THEN
    RETURN v_inv."clinicId"; -- repeat of a successful accept (double click / retry)
  END IF;
  IF v_inv.status <> 'PENDING' THEN
    RAISE EXCEPTION 'staff invitation: REVOKED' USING ERRCODE = '55000';
  END IF;
  IF v_inv."expiresAt" <= pg_catalog.now() THEN
    RAISE EXCEPTION 'staff invitation: EXPIRED' USING ERRCODE = '55000';
  END IF;
  SELECT r.key::text INTO v_role FROM public.roles r WHERE r.id = v_inv."roleId";
  IF v_role IS NULL OR NOT (v_role = ANY (ARRAY['DOCTOR', 'CLINIC_MANAGER', 'RECEPTIONIST', 'NURSE'])) THEN
    RAISE EXCEPTION 'staff invitation: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = v_inv."clinicId" AND c.status = 'ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_inv."branchId" AND b."clinicId" = v_inv."clinicId" AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'staff invitation: UNAVAILABLE' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_memberships m WHERE m."userId" = v_user.id AND m."clinicId" = v_inv."clinicId")
     OR EXISTS (SELECT 1 FROM public.patients p WHERE p."userId" = v_user.id AND p."clinicId" = v_inv."clinicId") THEN
    RAISE EXCEPTION 'staff invitation: ALREADY_MEMBER' USING ERRCODE = '23505';
  END IF;
  IF v_role = 'DOCTOR' THEN
    SELECT * INTO v_doc FROM public.staff_invitation_doctor_details x WHERE x."invitationId" = v_inv.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff invitation: UNAVAILABLE' USING ERRCODE = '55000';
    END IF;
    -- doctor_profiles.userId is globally unique: one doctor profile per person.
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d WHERE d."userId" = v_user.id) THEN
      RAISE EXCEPTION 'staff invitation: DOCTOR_PROFILE_EXISTS' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.doctor_profiles d
               WHERE d."clinicId" = v_inv."clinicId" AND pg_catalog.lower(d."registrationNumber") = pg_catalog.lower(v_doc."registrationNumber")) THEN
      RAISE EXCEPTION 'staff invitation: REGISTRATION_IN_USE' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Attribute audit events to the clinic being joined (transaction-local).
  PERFORM pg_catalog.set_config('app.clinic_id', v_inv."clinicId"::text, true);

  INSERT INTO public.clinic_memberships (id, "userId", "clinicId", "branchId", "roleId", status, "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_inv."clinicId", v_inv."branchId", v_inv."roleId", 'ACTIVE', pg_catalog.now())
  RETURNING id INTO v_membership;

  IF v_role = 'DOCTOR' THEN
    INSERT INTO public.doctor_profiles (id, "userId", "clinicId", "specialtyId", qualifications, "registrationNumber",
                                        "experienceYears", "consultationFeePaise", "onlineConsultation", status, "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_user.id, v_inv."clinicId", v_doc."specialtyId", v_doc.qualifications, v_doc."registrationNumber",
            v_doc."experienceYears", v_doc."consultationFeePaise", v_doc."onlineConsultation", 'ACTIVE', pg_catalog.now())
    RETURNING id INTO v_doctor;
    INSERT INTO public.doctor_branches ("doctorId", "branchId", "clinicId", "isPrimary")
    VALUES (v_doctor, v_inv."branchId", v_inv."clinicId", true);
  END IF;

  UPDATE public.staff_invitations SET status = 'ACCEPTED', "acceptedAt" = pg_catalog.now(),
         "membershipId" = v_membership, "updatedAt" = pg_catalog.now() WHERE id = v_inv.id;

  PERFORM app.log_event('staff.invitation_accepted', 'SUCCESS', 'staff_invitations', v_inv.id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('role', v_role, 'branchId', v_inv."branchId",
      'membershipId', v_membership, 'doctorId', v_doctor)));
  PERFORM app.add_notification(v_inv."clinicId", 'PERSONAL', v_inv."invitedByUserId", NULL, NULL,
    'STAFF_INVITATION_ACCEPTED', v_inv.id, pg_catalog.jsonb_build_object('role', v_role, 'branchId', v_inv."branchId"));
  RETURN v_inv."clinicId";
END
$$;

-- 11. Execute rights: the runtime role only, for the six entry points.
REVOKE ALL ON FUNCTION
  app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean),
  app.resend_staff_invitation(uuid), app.record_invitation_delivery(uuid, boolean, text),
  app.revoke_staff_invitation(uuid), app.my_staff_invitations(text), app.accept_staff_invitation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.create_staff_invitation(text, text, text, uuid, uuid, text, text, integer, integer, boolean),
  app.resend_staff_invitation(uuid), app.record_invitation_delivery(uuid, boolean, text),
  app.revoke_staff_invitation(uuid), app.my_staff_invitations(text), app.accept_staff_invitation(uuid, text) TO sehat_app;

-- 12. Row-level audit (ids + changed column names only; never email values).
CREATE TRIGGER audit_staff_invitations AFTER INSERT OR UPDATE OR DELETE ON staff_invitations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_staff_invitation_doctor_details AFTER INSERT OR UPDATE OR DELETE ON staff_invitation_doctor_details
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

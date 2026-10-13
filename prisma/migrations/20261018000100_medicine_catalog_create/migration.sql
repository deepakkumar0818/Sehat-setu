-- Shared medicine catalogue: administrators may ADD entries (approved design).
-- * The runtime role keeps SELECT-only on medicines; this migration grants no
--   table privilege. Creation goes through one SECURITY DEFINER function that
--   re-checks the caller (active staff member of the current clinic holding
--   medicine.catalog.create), validates, normalises and inserts.
-- * Duplicates (same normalised name + strength + dosage form) are blocked by a
--   unique index, so concurrent requests can't both succeed.
-- * Catalogue changes are audited by the existing app.audit_row_change()
--   trigger (row id, actor, originating clinic). Because that trigger records
--   no values on INSERT, the creation function ALSO writes one
--   'catalog.medicine_created' event via app.log_event() carrying the
--   medicine's identifying fields, in the same transaction as the insert.
--   Catalogue rows carry no clinic ownership; audit immutability is unchanged.
-- * Existing medicines, prescriptions, stock and history are not modified.
--   Nothing is dropped. (Checked before writing: the 17 existing rows have no
--   collisions under these rules.)

-- 1. Normalisation keys (IMMUTABLE: used by the indexes and the duplicate checks).
--    Name / generic name: lower-case, trimmed, runs of whitespace -> one space.
--    Strength: lower-case, ALL whitespace removed ("500 mg" = "500mg" = " 500  MG ").
CREATE FUNCTION app.medicine_text_key(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS
$$ SELECT pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p, '\s+', ' ', 'g'))) $$;

CREATE FUNCTION app.medicine_strength_key(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS
$$ SELECT pg_catalog.lower(pg_catalog.regexp_replace(p, '\s+', '', 'g')) $$;

-- New functions are executable by PUBLIC by default (schema app has no default ACL), so restrict explicitly.
REVOKE ALL ON FUNCTION app.medicine_text_key(text), app.medicine_strength_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.medicine_text_key(text), app.medicine_strength_key(text) TO sehat_app;

-- 2. Hard duplicate block. The original exact unique index stays.
CREATE UNIQUE INDEX medicines_normalized_key
  ON medicines (app.medicine_text_key(name), app.medicine_strength_key(strength), "dosageForm");
-- Supports the "same generic, strength and form under another brand" warning lookup.
CREATE INDEX medicines_generic_key
  ON medicines (app.medicine_text_key("genericName"), app.medicine_strength_key(strength), "dosageForm");

-- 3. The only write path for the runtime role.
CREATE FUNCTION app.create_catalog_medicine(p_name text, p_generic_name text, p_strength text, p_dosage_form text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  -- Stored for display: trimmed, inner whitespace runs collapsed (case kept as entered).
  v_name     text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_generic  text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_generic_name, ''), '\s+', ' ', 'g'));
  v_strength text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_strength, ''), '\s+', ' ', 'g'));
  v_form     public."DosageForm";
  v_id       uuid;
  v_existing uuid;
BEGIN
  -- Verified staff member of the current clinic (active membership, clinic and
  -- user) holding medicine.catalog.create. Patients are never staff.
  IF app.current_user_id() IS NULL OR app.current_clinic_id() IS NULL
     OR NOT app.is_staff_member() OR NOT app.staff_can(ARRAY['medicine.catalog.create']) THEN
    RAISE EXCEPTION 'catalog medicine: not permitted' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.length(v_name) NOT BETWEEN 2 AND 120
     OR pg_catalog.length(v_generic) NOT BETWEEN 2 AND 200
     OR pg_catalog.length(v_strength) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'catalog medicine: invalid field length' USING ERRCODE = '22023';
  END IF;
  IF (v_name || v_generic || v_strength) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'catalog medicine: invalid characters' USING ERRCODE = '22023';
  END IF;
  IF p_dosage_form IS NULL OR NOT (p_dosage_form = ANY (pg_catalog.enum_range(NULL::public."DosageForm")::text[])) THEN
    RAISE EXCEPTION 'catalog medicine: invalid dosage form' USING ERRCODE = '22023';
  END IF;
  v_form := p_dosage_form::public."DosageForm";

  -- Friendly duplicate error; the unique index is the real guarantee.
  SELECT m.id INTO v_existing FROM public.medicines m
  WHERE app.medicine_text_key(m.name) = app.medicine_text_key(v_name)
    AND app.medicine_strength_key(m.strength) = app.medicine_strength_key(v_strength)
    AND m."dosageForm" = v_form;
  IF FOUND THEN
    RAISE EXCEPTION 'catalog medicine: duplicate' USING ERRCODE = '23505', DETAIL = v_existing::text;
  END IF;

  BEGIN
    INSERT INTO public.medicines (id, name, "genericName", strength, "dosageForm", "isActive", "updatedAt")
    VALUES (pg_catalog.gen_random_uuid(), v_name, v_generic, v_strength, v_form, true, pg_catalog.now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent request created it first (this one waited on the index, then lost).
    SELECT m.id INTO v_existing FROM public.medicines m
    WHERE app.medicine_text_key(m.name) = app.medicine_text_key(v_name)
      AND app.medicine_strength_key(m.strength) = app.medicine_strength_key(v_strength)
      AND m."dosageForm" = v_form;
    RAISE EXCEPTION 'catalog medicine: duplicate' USING ERRCODE = '23505', DETAIL = coalesce(v_existing::text, '');
  END;

  -- Identifying fields of the created entry (public catalogue data only: no
  -- patient, clinical or credential data; max ~1.5 KB, within the 4 KB limit).
  -- Same transaction: if anything later fails, the event rolls back with the row.
  PERFORM app.log_event(
    'catalog.medicine_created', 'SUCCESS', 'medicines', v_id::text, NULL, NULL, NULL,
    pg_catalog.jsonb_build_object('name', v_name, 'genericName', v_generic, 'strength', v_strength, 'dosageForm', v_form::text));
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app.create_catalog_medicine(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_catalog_medicine(text, text, text, text) TO sehat_app;

-- 4. Audit every catalogue change with the existing trigger function.
--    medicines has no "clinicId", so app.audit_row_change() records the
--    ORIGINATING clinic from app.current_clinic_id() and the actor from
--    app.current_user_id() / app.current_auth_user_id(), as pinned by the server
--    from the verified session (and re-verified by the function above). Only
--    that clinic's administrators can read the event. Operator changes without
--    app context are recorded as 'db:<role>' with no clinic.
CREATE TRIGGER audit_medicines AFTER INSERT OR UPDATE OR DELETE ON medicines
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- 5. Permission, granted to Administrator only.
--    Idempotent when the row already exists with EXACTLY the expected values
--    (id = the seed's demoId('permission:medicine.catalog.create'); name, module
--    and description = src/data/permission-catalog.ts). Anything unexpected
--    fails the migration with a clear message instead of being accepted.
DO $$
DECLARE
  c_id     constant uuid := '80d36d83-413f-55b6-ada5-8002961f8173';
  c_key    constant text := 'medicine.catalog.create';
  c_name   constant text := 'Add catalogue medicines';
  c_module constant text := 'pharmacy';
  c_desc   constant text := 'Add a medicine to the shared catalogue used by every clinic.';
  r record;
BEGIN
  SELECT id, key, name, module, description INTO r FROM public.permissions WHERE key = c_key;
  IF FOUND THEN
    IF r.id <> c_id OR r.name IS DISTINCT FROM c_name OR r.module IS DISTINCT FROM c_module OR r.description IS DISTINCT FROM c_desc THEN
      RAISE EXCEPTION 'permission % already exists with unexpected values (id %, name %, module %, description %); expected id %, name %, module %, description %',
        c_key, r.id, pg_catalog.quote_nullable(r.name), pg_catalog.quote_nullable(r.module), pg_catalog.quote_nullable(r.description),
        c_id, pg_catalog.quote_literal(c_name), pg_catalog.quote_literal(c_module), pg_catalog.quote_literal(c_desc);
    END IF;
  ELSE
    -- The id must not already belong to a different permission.
    SELECT key INTO r FROM public.permissions WHERE id = c_id;
    IF FOUND THEN
      RAISE EXCEPTION 'permission id % is already used by %; expected it to be free for %', c_id, pg_catalog.quote_literal(r.key), c_key;
    END IF;
    INSERT INTO public.permissions (id, key, name, module, description) VALUES (c_id, c_key, c_name, c_module, c_desc);
  END IF;

  -- Grant to Administrator only. On an unseeded database (no roles yet) there is
  -- nothing to grant; the seed adds the grant from the TypeScript catalogue.
  IF EXISTS (SELECT 1 FROM public.roles) AND NOT EXISTS (SELECT 1 FROM public.roles WHERE key = 'ADMINISTRATOR') THEN
    RAISE EXCEPTION 'roles exist but ADMINISTRATOR is missing; refusing to continue';
  END IF;
  INSERT INTO public.role_permissions ("roleId", "permissionId")
  SELECT r2.id, c_id FROM public.roles r2 WHERE r2.key = 'ADMINISTRATOR'
  ON CONFLICT DO NOTHING;

  -- Postcondition: no role other than ADMINISTRATOR holds the permission.
  IF EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r3 ON r3.id = rp."roleId"
             WHERE rp."permissionId" = c_id AND r3.key <> 'ADMINISTRATOR') THEN
    RAISE EXCEPTION 'permission % is held by a role other than ADMINISTRATOR; refusing to continue', c_key;
  END IF;
END
$$;

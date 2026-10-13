-- Clinic-wide document numbering across visibility boundaries.
--
-- Invoice and prescription numbers are unique per clinic ("AAR-INV-0042",
-- "AAR-RX-0042"). Computing "the next number" needs the highest number in the
-- WHOLE clinic, but RLS correctly hides rows a user may not see — a
-- branch-restricted manager sees only their branch's invoices — so a max()
-- through RLS can return a number that's already taken in another branch.
--
-- This function returns only the next number (no row data), to verified staff
-- of the current clinic holding the permission that creates that document. It
-- takes a transaction-scoped advisory lock, so concurrent callers in the same
-- clinic are serialised until their transaction commits or rolls back: the
-- caller must insert the document in the SAME transaction.
-- Additive: no table or column changes.

CREATE OR REPLACE FUNCTION app.next_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_clinic uuid := app.current_clinic_id();
  v_code text;
  v_prefix text;
  v_next integer;
BEGIN
  IF v_clinic IS NULL OR NOT app.is_staff_member() THEN
    RAISE EXCEPTION 'next_document_number: no staff context' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'invoice' THEN
    IF NOT app.staff_can(ARRAY['invoice.create', 'billing.manage']) THEN
      RAISE EXCEPTION 'next_document_number: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF p_kind = 'prescription' THEN
    IF NOT app.staff_can(ARRAY['prescription.create', 'prescription.manage']) THEN
      RAISE EXCEPTION 'next_document_number: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'next_document_number: unknown kind' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('doc-number:' || p_kind || ':' || v_clinic::text));

  SELECT code INTO v_code FROM public.clinics WHERE id = v_clinic;
  v_prefix := v_code || CASE p_kind WHEN 'invoice' THEN '-INV-' ELSE '-RX-' END;

  IF p_kind = 'invoice' THEN
    SELECT coalesce(max(substr(i."invoiceNumber", length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.invoices i
    WHERE i."clinicId" = v_clinic
      AND starts_with(i."invoiceNumber", v_prefix)
      AND substr(i."invoiceNumber", length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  ELSE
    SELECT coalesce(max(substr(p."prescriptionNumber", length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.prescriptions p
    WHERE p."clinicId" = v_clinic
      AND starts_with(p."prescriptionNumber", v_prefix)
      AND substr(p."prescriptionNumber", length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  END IF;

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END
$$;

REVOKE ALL ON FUNCTION app.next_document_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_document_number(text) TO sehat_app;

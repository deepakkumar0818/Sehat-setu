-- Online payments through Razorpay, for patients:
--   * INVOICE:     paying the outstanding balance of one of their clinic bills;
--   * BOOKING_FEE: paying the doctor's consultation fee in advance for their own
--                  booking request (PENDING_APPROVAL) or confirmed visit.
--
-- Money rules live here, not in the browser:
--   * The amount is computed by the database (bill balance, or the doctor's fee)
--     and an order is recorded only if it still matches (app.record_online_order).
--   * A payment is recorded only by app.complete_online_payment, which the
--     server calls after verifying Razorpay's signature (checkout callback or
--     webhook). It is idempotent per order and per Razorpay payment id: a
--     repeated callback/webhook changes nothing. It writes a normal `payments`
--     row (method ONLINE, reference = Razorpay payment id) and re-derives the
--     invoice status; a booking fee gets an invoice for that appointment
--     (numbered like every invoice) if it has none yet.
--   * A booking fee is owed back when the request is declined or withdrawn
--     (or was paid twice / after closing): app.begin_online_refund marks the
--     order REFUND_PENDING before the server asks Razorpay to refund, and
--     app.finish_online_refund records the refund (payment REFUNDED; the
--     booking-fee invoice of a declined/cancelled visit becomes VOID).
--   * The runtime role can only READ orders (patients their own; billing staff
--     their clinic/branch). Every write is one of these SECURITY DEFINER
--     functions. Card/UPI details never reach this database.
-- Additive only.

CREATE TYPE "OnlinePaymentPurpose" AS ENUM ('INVOICE', 'BOOKING_FEE');
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('CREATED', 'PAID', 'REFUND_PENDING', 'REFUNDED');

CREATE TABLE "online_payment_orders" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clinicId"           uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  "branchId"           uuid NOT NULL,
  "patientId"          uuid NOT NULL,
  "purpose"            "OnlinePaymentPurpose" NOT NULL,
  "invoiceId"          uuid,
  "appointmentId"      uuid,
  "amountPaise"        integer NOT NULL CHECK ("amountPaise" BETWEEN 100 AND 50000000),
  "currency"           text NOT NULL DEFAULT 'INR' CHECK ("currency" = 'INR'),
  "provider"           text NOT NULL DEFAULT 'RAZORPAY' CHECK ("provider" = 'RAZORPAY'),
  "providerOrderId"    text NOT NULL UNIQUE CHECK ("providerOrderId" ~ '^order_[A-Za-z0-9]{6,40}$'),
  "status"             "OnlinePaymentStatus" NOT NULL DEFAULT 'CREATED',
  "providerPaymentId"  text UNIQUE CHECK ("providerPaymentId" IS NULL OR "providerPaymentId" ~ '^pay_[A-Za-z0-9]{6,40}$'),
  "paymentId"          uuid REFERENCES payments(id) ON DELETE RESTRICT,
  "providerRefundId"   text CHECK ("providerRefundId" IS NULL OR "providerRefundId" ~ '^rfnd_[A-Za-z0-9]{6,40}$'),
  "refundReason"       text CHECK ("refundReason" IS NULL OR pg_catalog.length("refundReason") <= 300),
  "paidAt"             timestamptz(6),
  "refundRequestedAt"  timestamptz(6),
  "refundedAt"         timestamptz(6),
  "createdByUserId"    uuid REFERENCES users(id) ON DELETE SET NULL,
  "createdAt"          timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT online_payment_orders_branch_fk FOREIGN KEY ("clinicId", "branchId") REFERENCES branches("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT online_payment_orders_patient_fk FOREIGN KEY ("clinicId", "patientId") REFERENCES patients("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT online_payment_orders_invoice_fk FOREIGN KEY ("clinicId", "invoiceId") REFERENCES invoices("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT online_payment_orders_appointment_fk FOREIGN KEY ("clinicId", "appointmentId") REFERENCES appointments("clinicId", id) ON DELETE RESTRICT,
  CONSTRAINT online_payment_orders_target CHECK (
    ("purpose" = 'INVOICE' AND "invoiceId" IS NOT NULL) OR ("purpose" = 'BOOKING_FEE' AND "appointmentId" IS NOT NULL)
  ),
  CONSTRAINT online_payment_orders_paid_consistent CHECK (
    ("status" = 'CREATED') = ("providerPaymentId" IS NULL) AND ("status" = 'CREATED') = ("paymentId" IS NULL)
  )
);
CREATE INDEX online_payment_orders_patient_idx ON online_payment_orders ("clinicId", "patientId", "createdAt" DESC);
CREATE INDEX online_payment_orders_appointment_idx ON online_payment_orders ("clinicId", "appointmentId") WHERE "appointmentId" IS NOT NULL;
CREATE INDEX online_payment_orders_refund_idx ON online_payment_orders ("clinicId", "status") WHERE "status" = 'REFUND_PENDING';

REVOKE ALL ON online_payment_orders FROM anon, authenticated;
GRANT SELECT ON online_payment_orders TO sehat_app;
ALTER TABLE online_payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY online_payment_orders_read ON online_payment_orders FOR SELECT TO sehat_app USING (
  "clinicId" = (SELECT app.current_clinic_id())
  AND (
    "patientId" = ANY ((SELECT app.current_patient_ids())::uuid[])
    OR (app.branch_visible("branchId")
        AND (SELECT app.staff_can(ARRAY['billing.view', 'billing.manage', 'payment.view', 'invoice.view', 'appointment.update'])))
  )
);
-- No INSERT/UPDATE/DELETE grants: only the functions below write.

CREATE TRIGGER audit_online_payment_orders AFTER INSERT OR UPDATE OR DELETE ON online_payment_orders
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to anyone)
-- ---------------------------------------------------------------------------

-- Next invoice number for a clinic, exactly as app.next_document_number('invoice')
-- (same lock, same format), for invoices the payment flow creates without staff.
CREATE FUNCTION app.allocate_invoice_number(p_clinic uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_prefix text;
  v_next integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('doc-number:invoice:' || p_clinic::text));
  SELECT c.code || '-INV-' INTO v_prefix FROM public.clinics c WHERE c.id = p_clinic;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(pg_catalog.substr(i."invoiceNumber", pg_catalog.length(v_prefix) + 1)::integer), 0) + 1 INTO v_next
    FROM public.invoices i
   WHERE i."clinicId" = p_clinic AND pg_catalog.starts_with(i."invoiceNumber", v_prefix)
     AND pg_catalog.substr(i."invoiceNumber", pg_catalog.length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  RETURN v_prefix || pg_catalog.lpad(v_next::text, 4, '0');
END
$$;
REVOKE ALL ON FUNCTION app.allocate_invoice_number(uuid) FROM PUBLIC;

-- Status of an invoice from its succeeded payments (VOID stays VOID), as billing-math.ts deriveInvoiceStatus.
CREATE FUNCTION app.rederive_invoice_status(p_invoice uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_total integer;
  v_status text;
  v_paid integer;
BEGIN
  SELECT i."totalPaise", i.status::text INTO v_total, v_status FROM public.invoices i WHERE i.id = p_invoice;
  IF v_status IS NULL OR v_status = 'VOID' THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(p."amountPaise"), 0)::integer INTO v_paid FROM public.payments p WHERE p."invoiceId" = p_invoice AND p.status = 'SUCCEEDED';
  UPDATE public.invoices
     SET status = (CASE WHEN v_paid >= v_total THEN 'PAID' WHEN v_paid > 0 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END)::public."InvoiceStatus",
         "updatedAt" = pg_catalog.now()
   WHERE id = p_invoice
     AND status::text IS DISTINCT FROM (CASE WHEN v_paid >= v_total THEN 'PAID' WHEN v_paid > 0 THEN 'PARTIALLY_PAID' ELSE 'PENDING' END);
END
$$;
REVOKE ALL ON FUNCTION app.rederive_invoice_status(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Patient: what can be paid, and recording a Razorpay order for it
-- ---------------------------------------------------------------------------

-- What the signed-in patient owes for one bill or one booking (amount in paise), or a refusal:
-- 'online payment: NOT_FOUND | NOTHING_DUE | NOT_PAYABLE | ALREADY_PAID'.
CREATE FUNCTION app.online_payable(p_purpose text, p_ref uuid)
  RETURNS TABLE (amount_paise integer, branch_id uuid, patient_id uuid, invoice_id uuid, appointment_id uuid, label text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_patient uuid := app.booking_current_patient();
  v_clinic  uuid := app.current_clinic_id();
  v_inv     public.invoices%ROWTYPE;
  v_appt    public.appointments%ROWTYPE;
  v_paid    integer;
  v_fee     integer;
BEGIN
  IF p_purpose = 'INVOICE' THEN
    SELECT * INTO v_inv FROM public.invoices i WHERE i.id = p_ref AND i."clinicId" = v_clinic AND i."patientId" = v_patient;
    IF v_inv.id IS NULL THEN
      RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
    END IF;
    IF v_inv.status::text NOT IN ('PENDING', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'online payment: NOTHING_DUE' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(sum(p."amountPaise"), 0)::integer INTO v_paid FROM public.payments p WHERE p."invoiceId" = v_inv.id AND p.status = 'SUCCEEDED';
    IF v_inv."totalPaise" - v_paid < 100 THEN
      RAISE EXCEPTION 'online payment: NOTHING_DUE' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_inv."totalPaise" - v_paid, v_inv."branchId", v_patient, v_inv.id, v_inv."appointmentId", 'Bill ' || v_inv."invoiceNumber";
  ELSIF p_purpose = 'BOOKING_FEE' THEN
    SELECT * INTO v_appt FROM public.appointments a WHERE a.id = p_ref AND a."clinicId" = v_clinic AND a."patientId" = v_patient;
    IF v_appt.id IS NULL THEN
      RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
    END IF;
    IF v_appt.status::text NOT IN ('PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED') OR v_appt."startsAt" <= pg_catalog.now() THEN
      RAISE EXCEPTION 'online payment: NOT_PAYABLE' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.online_payment_orders o WHERE o."appointmentId" = v_appt.id AND o.status::text IN ('PAID', 'REFUND_PENDING'))
       OR EXISTS (SELECT 1 FROM public.invoices i WHERE i."clinicId" = v_clinic AND i."appointmentId" = v_appt.id) THEN
      -- Already paid, or the clinic has billed the visit (then the bill is what's paid).
      RAISE EXCEPTION 'online payment: ALREADY_PAID' USING ERRCODE = '22023';
    END IF;
    SELECT d."consultationFeePaise" INTO v_fee FROM public.doctor_profiles d WHERE d.id = v_appt."doctorId" AND d."clinicId" = v_clinic;
    IF coalesce(v_fee, 0) < 100 THEN
      RAISE EXCEPTION 'online payment: NOTHING_DUE' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_fee, v_appt."branchId", v_patient, NULL::uuid, v_appt.id, 'Consultation fee';
  ELSE
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
END
$$;

-- Records the Razorpay order the server just created for exactly the payable amount.
CREATE FUNCTION app.record_online_order(p_purpose text, p_ref uuid, p_provider_order_id text, p_amount integer) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_due record;
  v_id  uuid;
BEGIN
  SELECT * INTO v_due FROM app.online_payable(p_purpose, p_ref);
  IF v_due.amount_paise IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'online payment: AMOUNT_CHANGED' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.online_payment_orders ("clinicId", "branchId", "patientId", purpose, "invoiceId", "appointmentId", "amountPaise", "providerOrderId", "createdByUserId")
  VALUES (app.current_clinic_id(), v_due.branch_id, v_due.patient_id, p_purpose::public."OnlinePaymentPurpose",
          CASE WHEN p_purpose = 'INVOICE' THEN v_due.invoice_id END, v_due.appointment_id, p_amount, p_provider_order_id, app.current_user_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- Server (after Razorpay's signature is verified): record the payment
-- ---------------------------------------------------------------------------

-- Returns 'PAID', 'ALREADY_PAID' (same payment seen again) or 'PAID_NEEDS_REFUND'
-- (money arrived for a booking that is no longer open, or a second payment for it).
CREATE FUNCTION app.complete_online_payment(p_provider_order_id text, p_provider_payment_id text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_order   public.online_payment_orders%ROWTYPE;
  v_appt    public.appointments%ROWTYPE;
  v_invoice uuid;
  v_payment uuid;
  v_fee_invoice boolean := false;
  v_number  text;
  v_refund  boolean := false;
BEGIN
  IF p_provider_payment_id IS NULL OR p_provider_payment_id !~ '^pay_[A-Za-z0-9]{6,40}$' THEN
    RAISE EXCEPTION 'online payment: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.online_payment_orders o WHERE o."providerOrderId" = p_provider_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'CREATED' THEN
    IF v_order."providerPaymentId" = p_provider_payment_id THEN
      RETURN 'ALREADY_PAID';
    END IF;
    RAISE EXCEPTION 'online payment: CONFLICT' USING ERRCODE = '23505'; -- a different payment for a settled order
  END IF;

  IF v_order.purpose = 'INVOICE' THEN
    v_invoice := v_order."invoiceId";
  ELSE
    SELECT * INTO v_appt FROM public.appointments a WHERE a.id = v_order."appointmentId";
    SELECT i.id INTO v_invoice FROM public.invoices i WHERE i."clinicId" = v_order."clinicId" AND i."appointmentId" = v_order."appointmentId";
    v_refund := v_appt.status::text NOT IN ('PENDING_APPROVAL', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')
                OR EXISTS (SELECT 1 FROM public.online_payment_orders o
                            WHERE o."appointmentId" = v_order."appointmentId" AND o.id <> v_order.id AND o.status::text IN ('PAID', 'REFUND_PENDING'));
    IF v_invoice IS NULL THEN
      v_number := app.allocate_invoice_number(v_order."clinicId");
      INSERT INTO public.invoices (id, "clinicId", "branchId", "patientId", "appointmentId", "invoiceNumber", "issuedAt", "subtotalPaise", "totalPaise", status, "updatedAt")
      VALUES (pg_catalog.gen_random_uuid(), v_order."clinicId", v_order."branchId", v_order."patientId", v_order."appointmentId", v_number, pg_catalog.now(),
              v_order."amountPaise", v_order."amountPaise", 'PENDING', pg_catalog.now())
      RETURNING id INTO v_invoice;
      INSERT INTO public.invoice_line_items (id, "invoiceId", description, category, quantity, "unitPricePaise", "amountPaise")
      VALUES (pg_catalog.gen_random_uuid(), v_invoice, 'Consultation fee (paid online in advance)', 'CONSULTATION', 1, v_order."amountPaise", v_order."amountPaise");
      v_fee_invoice := true;
    END IF;
  END IF;

  -- Same lock as the staff billing path, so a cash payment and this one can't interleave.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('invoice:' || v_invoice::text));
  INSERT INTO public.payments (id, "clinicId", "invoiceId", "amountPaise", method, status, reference, "paidAt")
  VALUES (pg_catalog.gen_random_uuid(), v_order."clinicId", v_invoice, v_order."amountPaise", 'ONLINE', 'SUCCEEDED', p_provider_payment_id, pg_catalog.now())
  RETURNING id INTO v_payment;
  PERFORM app.rederive_invoice_status(v_invoice);

  UPDATE public.online_payment_orders
     SET status = 'PAID', "providerPaymentId" = p_provider_payment_id, "paymentId" = v_payment,
         "invoiceId" = coalesce("invoiceId", v_invoice), "paidAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now()
   WHERE id = v_order.id;
  PERFORM app.log_event('billing.online_payment_received', 'SUCCESS', 'invoice', v_invoice::text, NULL, 'razorpay', NULL,
    pg_catalog.jsonb_build_object('purpose', v_order.purpose::text, 'amountPaise', v_order."amountPaise", 'invoiceCreated', v_fee_invoice));
  RETURN CASE WHEN v_refund THEN 'PAID_NEEDS_REFUND' ELSE 'PAID' END;
END
$$;

-- ---------------------------------------------------------------------------
-- Refunds (booking fees owed back; or billing staff for any paid order)
-- ---------------------------------------------------------------------------

-- Marks a paid order REFUND_PENDING and returns what to refund. Allowed when the
-- fee is owed back (declined/withdrawn/cancelled booking, or a duplicate payment),
-- or for staff holding refund.manage / billing.manage. Repeating it is harmless.
CREATE FUNCTION app.begin_online_refund(p_order_id uuid, p_reason text)
  RETURNS TABLE (provider_payment_id text, amount_paise integer, provider_order_id text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_order public.online_payment_orders%ROWTYPE;
  v_owed  boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.online_payment_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR (app.current_clinic_id() IS NOT NULL AND v_order."clinicId" <> app.current_clinic_id()) THEN
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_order.status NOT IN ('PAID', 'REFUND_PENDING') THEN
    RAISE EXCEPTION 'online payment: NOT_REFUNDABLE' USING ERRCODE = '22023';
  END IF;
  IF v_order.purpose = 'BOOKING_FEE' THEN
    v_owed := EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = v_order."appointmentId" AND a.status::text IN ('REJECTED', 'CANCELLED', 'NO_SHOW'))
              OR EXISTS (SELECT 1 FROM public.online_payment_orders o
                          WHERE o."appointmentId" = v_order."appointmentId" AND o.id <> v_order.id AND o.status::text IN ('PAID', 'REFUND_PENDING', 'REFUNDED')
                            AND o."paidAt" < v_order."paidAt");
  END IF;
  IF NOT v_owed AND NOT (app.is_staff_member() AND app.branch_visible(v_order."branchId") AND app.staff_can(ARRAY['refund.manage', 'billing.manage'])) THEN
    RAISE EXCEPTION 'online payment: NOT_PERMITTED' USING ERRCODE = '42501';
  END IF;
  IF v_order.status = 'PAID' THEN
    UPDATE public.online_payment_orders
       SET status = 'REFUND_PENDING', "refundRequestedAt" = pg_catalog.now(),
           "refundReason" = pg_catalog.left(coalesce(NULLIF(pg_catalog.btrim(p_reason), ''), 'Refund'), 300), "updatedAt" = pg_catalog.now()
     WHERE id = v_order.id;
  END IF;
  RETURN QUERY SELECT v_order."providerPaymentId", v_order."amountPaise", v_order."providerOrderId";
END
$$;

-- Records Razorpay's refund for a REFUND_PENDING order (idempotent): the payment
-- becomes REFUNDED, the invoice status is re-derived, and the booking-fee invoice
-- of a declined/cancelled visit with nothing else paid becomes VOID.
CREATE FUNCTION app.finish_online_refund(p_provider_payment_id text, p_provider_refund_id text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_order public.online_payment_orders%ROWTYPE;
BEGIN
  IF p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]{6,40}$' THEN
    RAISE EXCEPTION 'online payment: INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.online_payment_orders o WHERE o."providerPaymentId" = p_provider_payment_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'online payment: NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'REFUNDED' THEN
    RETURN 'ALREADY_REFUNDED';
  END IF;
  IF v_order.status <> 'REFUND_PENDING' THEN
    RAISE EXCEPTION 'online payment: NOT_REFUNDABLE' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('invoice:' || v_order."invoiceId"::text));
  UPDATE public.payments SET status = 'REFUNDED' WHERE id = v_order."paymentId" AND status = 'SUCCEEDED';
  IF v_order.purpose = 'BOOKING_FEE'
     AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = v_order."appointmentId" AND a.status::text IN ('REJECTED', 'CANCELLED'))
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p."invoiceId" = v_order."invoiceId" AND p.status = 'SUCCEEDED') THEN
    UPDATE public.invoices SET status = 'VOID', "updatedAt" = pg_catalog.now() WHERE id = v_order."invoiceId" AND status <> 'VOID';
  ELSE
    PERFORM app.rederive_invoice_status(v_order."invoiceId");
  END IF;
  UPDATE public.online_payment_orders
     SET status = 'REFUNDED', "providerRefundId" = p_provider_refund_id, "refundedAt" = pg_catalog.now(), "updatedAt" = pg_catalog.now()
   WHERE id = v_order.id;
  PERFORM app.log_event('billing.online_payment_refunded', 'SUCCESS', 'invoice', v_order."invoiceId"::text, NULL, 'razorpay', NULL,
    pg_catalog.jsonb_build_object('purpose', v_order.purpose::text, 'amountPaise', v_order."amountPaise"));
  RETURN 'REFUNDED';
END
$$;

REVOKE ALL ON FUNCTION app.online_payable(text, uuid), app.record_online_order(text, uuid, text, integer),
  app.complete_online_payment(text, text), app.begin_online_refund(uuid, text), app.finish_online_refund(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.online_payable(text, uuid), app.record_online_order(text, uuid, text, integer),
  app.complete_online_payment(text, text), app.begin_online_refund(uuid, text), app.finish_online_refund(text, text) TO sehat_app;

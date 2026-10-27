-- Super admin console, part 3: read-only views for the Payments and Settings
-- pages. Functions only; no tables, no data changed.
-- * app.platform_payments(clinic, before): every subscription payment, newest
--   first, 50 at a time, with its clinic.
-- * app.platform_payment_totals(): money received per month (India's calendar)
--   for the last 12 months, voided payments excluded.
-- * app.platform_admin_list(): who has super admin access.
-- Each first checks app.is_platform_admin() for the verified session.
-- Additive only.

CREATE FUNCTION app.platform_payments(p_clinic uuid, p_before timestamptz) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.require_platform_admin();
  RETURN (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', sp.id, 'clinicId', sp."clinicId", 'clinicName', c.name, 'clinicCode', c.code,
            'amountPaise', sp."amountPaise", 'method', sp.method, 'reference', sp.reference,
            'paidOn', sp."paidOn", 'months', sp.months, 'periodFrom', sp."periodFrom", 'periodTo', sp."periodTo",
            'notes', sp.notes, 'recordedBy', ru.name, 'createdAt', sp."createdAt",
            'voidedAt', sp."voidedAt", 'voidReason', sp."voidReason"
          ) ORDER BY sp."createdAt" DESC, sp.id), '[]'::jsonb)
          FROM (SELECT * FROM public.clinic_subscription_payments x
                 WHERE (p_clinic IS NULL OR x."clinicId" = p_clinic)
                   AND (p_before IS NULL OR x."createdAt" < p_before)
                 ORDER BY x."createdAt" DESC, x.id
                 LIMIT 50) sp
          JOIN public.clinics c ON c.id = sp."clinicId"
          LEFT JOIN public.users ru ON ru.id = sp."recordedByUserId");
END
$$;
REVOKE ALL ON FUNCTION app.platform_payments(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_payments(uuid, timestamptz) TO sehat_app;

CREATE FUNCTION app.platform_payment_totals() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
DECLARE
  v_this date := pg_catalog.date_trunc('month', app.ist_today())::date;
BEGIN
  PERFORM app.require_platform_admin();
  RETURN (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'month', pg_catalog.to_char(m, 'YYYY-MM'),
            'amountPaise', (SELECT coalesce(pg_catalog.sum(sp."amountPaise"), 0) FROM public.clinic_subscription_payments sp
                             WHERE sp."voidedAt" IS NULL AND sp."paidOn" >= m::date AND sp."paidOn" < (m + interval '1 month')::date),
            'payments', (SELECT pg_catalog.count(*) FROM public.clinic_subscription_payments sp
                          WHERE sp."voidedAt" IS NULL AND sp."paidOn" >= m::date AND sp."paidOn" < (m + interval '1 month')::date)
          ) ORDER BY m)
          FROM pg_catalog.generate_series(v_this - interval '11 months', v_this::timestamp, interval '1 month') AS m);
END
$$;
REVOKE ALL ON FUNCTION app.platform_payment_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_payment_totals() TO sehat_app;

CREATE FUNCTION app.platform_admin_list() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS
$$
BEGIN
  PERFORM app.require_platform_admin();
  RETURN (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'userId', u.id, 'name', u.name, 'email', u.email, 'status', u.status,
            'signedIn', u."authProviderId" IS NOT NULL, 'since', pa."createdAt",
            'isYou', u.id = app.current_user_id()
          ) ORDER BY pa."createdAt", u.name), '[]'::jsonb)
          FROM public.platform_admins pa JOIN public.users u ON u.id = pa."userId");
END
$$;
REVOKE ALL ON FUNCTION app.platform_admin_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_admin_list() TO sehat_app;

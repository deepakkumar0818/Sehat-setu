import "server-only";
import type { TenantTx } from "@/server/db/tenant";

// Whether staff invitations can be created safely on this database: the P5
// migration (20261019000100), its fix (20261019000200, marker "P5-FIX-1") AND
// the phone number (20261020000000, marker "P5-PHONE-1", which adds p_phone to
// app.create_staff_invitation) are applied. Before the fix the function refused
// every existing account as ALREADY_MEMBER, which also revealed whether an email
// had an account elsewhere — so creation stays off until it's in place.
// Read-only catalogue lookups; lets the UI say "not set up yet" instead of
// offering a form that can only fail (or leak).

/** Whether the Staff directory's Edit phone can work: migration 20261020000100 (app.set_staff_phone, marker "P5-PHONE-EDIT-1"). */
export async function staffPhoneEditReady(tx: TenantTx): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT coalesce((SELECT position('P5-PHONE-EDIT-1' IN p.prosrc) > 0 FROM pg_catalog.pg_proc p
                      WHERE p.oid = to_regprocedure('app.set_staff_phone(uuid, text)')), false) AS ok`;
  return Boolean(row?.ok);
}

export async function invitationsReady(tx: TenantTx): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regclass('public.staff_invitations') IS NOT NULL
       AND coalesce((SELECT position('P5-FIX-1' IN p.prosrc) > 0 AND position('P5-PHONE-1' IN p.prosrc) > 0 FROM pg_catalog.pg_proc p
                      WHERE p.oid = to_regprocedure('app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean)')), false) AS ok`;
  return Boolean(row?.ok);
}

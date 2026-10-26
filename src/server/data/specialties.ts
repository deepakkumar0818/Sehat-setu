import "server-only";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { SpecialtyOption } from "@/lib/live-types";
import { runScoped } from "./scope";

// The specialties a clinic can use: the shared catalogue plus the clinic's own
// (RLS hides other clinics' own). Read by any active staff member, e.g. for
// doctor filters and doctor invitations.


export async function listSpecialties(ctx: TenantContext, db?: TenantTx): Promise<{ items: SpecialtyOption[] }> {
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.specialty.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    return { items: rows };
  });
}

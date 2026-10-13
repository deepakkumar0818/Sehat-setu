import "server-only";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { SpecialtyOption } from "@/lib/live-types";
import { runScoped } from "./scope";

// The shared specialty catalogue (public reference data, no tenant rows). Read
// by any active staff member, e.g. for doctor filters and doctor invitations.


export async function listSpecialties(ctx: TenantContext, db?: TenantTx): Promise<{ items: SpecialtyOption[] }> {
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.specialty.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    return { items: rows };
  });
}

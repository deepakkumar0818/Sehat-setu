import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { CatalogMedicine, CatalogPage } from "@/services/clinical";
import { createCatalogMedicineSchema } from "./medicine-rules";
import { runScoped } from "./scope";

// The shared medicine catalogue (one list for every clinic; no tenant data).
//
// Reading: anyone who prescribes or handles stock. Searching is server-side and
// paged (≤ 25 per page), so the whole catalogue is reachable.
// Adding: only medicine.catalog.create (Administrator). The runtime role has no
// write access to `medicines`; the database function app.create_catalog_medicine()
// re-checks the permission, normalises, blocks duplicates (unique index) and
// writes the audit events. Editing or deactivating entries is operator-only.

export const CATALOG_CREATE = ["medicine.catalog.create"] as const;
export const CATALOG_VIEW = [
  "prescription.view", "prescription.manage", "prescription.create",
  "medicine.view", "pharmacy.inventory.view", "pharmacy.inventory.manage", "pharmacy.manage",
  ...CATALOG_CREATE,
] as const;

const MAX_PAGE = 25;
const select = { id: true, name: true, genericName: true, strength: true, dosageForm: true } as const;
const toUi = (m: { id: string; name: string; genericName: string; strength: string; dosageForm: string }): CatalogMedicine => ({ ...m, dosageForm: m.dosageForm.toLowerCase() });

export const searchCatalogSchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

/** One page of active catalogue entries matching `search` (name or generic name), alphabetical. */
export async function searchCatalog(ctx: TenantContext, input: z.infer<typeof searchCatalogSchema>, db?: TenantTx): Promise<CatalogPage> {
  requirePermission(ctx, CATALOG_VIEW);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), MAX_PAGE);
  const page = input.page ?? 1;
  const search = input.search?.trim();
  const where = {
    isActive: true,
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { genericName: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.medicine.findMany({ where, orderBy: [{ name: "asc" }, { strength: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select }),
      tx.medicine.count({ where }),
    ]);
    return { items: rows.map(toUi), total, page, pageSize, canCreate: hasAnyPermission(ctx, CATALOG_CREATE) };
  });
}

/** Database refusals from app.create_catalog_medicine(), as API errors. */
function mapCreateError(err: unknown): never {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  const text = parts.join(" | ");
  if (/catalog medicine: duplicate/.test(text)) throw new DataError("DUPLICATE", "That medicine is already in the catalogue.");
  if (/catalog medicine: not permitted/.test(text)) throw new AuthError("FORBIDDEN");
  if (/catalog medicine: invalid/.test(text)) throw new DataError("INVALID_INPUT", "Check the medicine's name, generic name, strength and dosage form.");
  throw err;
}

/**
 * Adds a medicine to the shared catalogue.
 * - Same normalised name + strength + form already present → 409 DUPLICATE (with the existing entry).
 * - Same generic name + strength + form under a different name, not yet confirmed → 409 NEEDS_CONFIRMATION (with the matches).
 */
export async function createCatalogMedicine(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<CatalogMedicine> {
  requirePermission(ctx, CATALOG_CREATE);
  const input = createCatalogMedicineSchema.parse(raw);
  const form = input.dosageForm.toUpperCase();
  return runScoped(ctx, db, async (tx) => {
    // Checked first so the user sees the existing entry; the unique index decides under concurrency.
    const existing = await tx.$queryRaw<CatalogMedicine[]>`
      SELECT id, name, "genericName", strength, "dosageForm"::text AS "dosageForm" FROM medicines
      WHERE app.medicine_text_key(name) = app.medicine_text_key(${input.name})
        AND app.medicine_strength_key(strength) = app.medicine_strength_key(${input.strength})
        AND "dosageForm" = ${form}::"DosageForm"`;
    if (existing.length) throw new DataError("DUPLICATE", `${existing[0].name} ${existing[0].strength} (${existing[0].dosageForm.toLowerCase()}) is already in the catalogue.`, { existing: toUi(existing[0]) });

    if (!input.confirmGenericMatch) {
      const sameGeneric = await tx.$queryRaw<CatalogMedicine[]>`
        SELECT id, name, "genericName", strength, "dosageForm"::text AS "dosageForm" FROM medicines
        WHERE app.medicine_text_key("genericName") = app.medicine_text_key(${input.genericName})
          AND app.medicine_strength_key(strength) = app.medicine_strength_key(${input.strength})
          AND "dosageForm" = ${form}::"DosageForm"
        ORDER BY name LIMIT 10`;
      if (sameGeneric.length) {
        throw new DataError("NEEDS_CONFIRMATION", "The catalogue already has this generic medicine at the same strength and form under another name.", { matches: sameGeneric.map(toUi) });
      }
    }

    let id: string;
    try {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT app.create_catalog_medicine(${input.name}, ${input.genericName}, ${input.strength}, ${form}) AS id`;
      id = rows[0].id;
    } catch (err) {
      mapCreateError(err);
    }
    const created = await tx.medicine.findUniqueOrThrow({ where: { id }, select });
    return toUi(created);
  });
}

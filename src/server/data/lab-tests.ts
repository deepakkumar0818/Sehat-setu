import "server-only";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { LabTestCategory, LabTestPage, LiveLabTest } from "@/lib/live-types";
import { isUuid, labTestInputSchema, labTestPatchSchema } from "./clinic-admin-rules";
import { errorText } from "./document-rules";
import { runScoped } from "./scope";

// The clinic's lab test master (lab_test_types): every staff member reads it
// (doctors order tests from it in a consultation); clinic-wide administrators
// add, rename and deactivate tests. RLS (lab_test_types_* policies) enforces
// the same rules, and row-change triggers audit every write.

export const LAB_TEST_MANAGE = ["clinic.settings.manage"] as const;

const labTestSelect = { id: true, name: true, category: true, status: true } as const;
type LabTestRow = { id: string; name: string; category: "PATHOLOGY" | "RADIOLOGY" | "CARDIOLOGY" | "OTHER"; status: "ACTIVE" | "INACTIVE" };

const toLabTest = (t: LabTestRow): LiveLabTest => ({
  id: t.id,
  name: t.name,
  category: t.category.toLowerCase() as LabTestCategory,
  status: t.status === "ACTIVE" ? "active" : "inactive",
});
const toDbCategory = (c: LabTestCategory) => c.toUpperCase() as LabTestRow["category"];

/** A branch-restricted member can read the list but not change it (it is clinic-wide). */
const canManage = (ctx: TenantContext) => hasAnyPermission(ctx, LAB_TEST_MANAGE) && !ctx.branchId;

function requireManage(ctx: TenantContext) {
  requirePermission(ctx, LAB_TEST_MANAGE);
  if (ctx.branchId) throw new AuthError("FORBIDDEN");
}

// P2002 from Prisma model writes; SQLSTATE 23505 from the raw INSERT below.
const isUniqueViolation = (err: unknown) =>
  (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") || /23505/.test(errorText(err));
const duplicate = (name: string) => new DataError("DUPLICATE", `${name} is already in the list.`);

export async function listLabTests(ctx: TenantContext, db?: TenantTx): Promise<LabTestPage> {
  return runScoped(ctx, db, async (tx) => {
    const rows = await tx.labTestType.findMany({
      where: { clinicId: ctx.clinicId },
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      select: labTestSelect,
    });
    return { items: rows.map(toLabTest), canManage: canManage(ctx) };
  });
}

async function checkName(ctx: TenantContext, tx: TenantTx, name: string, exceptId?: string) {
  const clash = await tx.labTestType.findFirst({
    where: { clinicId: ctx.clinicId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw duplicate(name);
}

export async function createLabTest(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<LiveLabTest> {
  requireManage(ctx);
  const input = labTestInputSchema.parse(raw);
  try {
    return await runScoped(ctx, db, async (tx) => {
      await checkName(ctx, tx, input.name);
      // Raw INSERT naming only the granted columns: Prisma's create also sends
      // status/createdAt, which the app role may not set (column-level grants).
      const [row] = await tx.$queryRaw<LabTestRow[]>`
        INSERT INTO lab_test_types ("clinicId", "name", "category", "updatedAt")
        VALUES (${ctx.clinicId}::uuid, ${input.name}, ${toDbCategory(input.category)}::"LabTestCategory", now())
        RETURNING id::text AS id, name, category::text AS category, status::text AS status`;
      return toLabTest(row);
    });
  } catch (err) {
    // Two admins adding the same name at once: the unique index decides.
    if (isUniqueViolation(err)) throw duplicate(input.name);
    throw err;
  }
}

/** Rename / recategorise a test, or { status } to deactivate or reactivate it. */
export async function updateLabTest(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<LiveLabTest> {
  requireManage(ctx);
  if (!isUuid(id)) throw new AuthError("NOT_FOUND");
  const patch = labTestPatchSchema.parse(raw);
  try {
    return await runScoped(ctx, db, async (tx) => {
      const test = await tx.labTestType.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { id: true, name: true } });
      if (!test) throw new AuthError("NOT_FOUND");
      if ("status" in patch) {
        return toLabTest(await tx.labTestType.update({ where: { id }, data: { status: patch.status === "active" ? "ACTIVE" : "INACTIVE" }, select: labTestSelect }));
      }
      if (patch.name && patch.name.toLowerCase() !== test.name.toLowerCase()) await checkName(ctx, tx, patch.name, id);
      const row = await tx.labTestType.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.category !== undefined && { category: toDbCategory(patch.category) }),
        },
        select: labTestSelect,
      });
      return toLabTest(row);
    });
  } catch (err) {
    if (isUniqueViolation(err) && "name" in patch && patch.name) throw duplicate(patch.name);
    throw err;
  }
}

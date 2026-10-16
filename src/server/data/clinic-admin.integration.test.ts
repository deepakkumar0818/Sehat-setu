import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { activeAdminContext, adminClient, inRollback } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import { istTodayKey } from "@/lib/ist";
import { createBranch, createDepartment, getClinicProfile, listDepartments, listSpecialtyUsage, updateBranch, updateClinicProfile, updateDepartment } from "./clinic-setup";
import { listAuditEvents } from "./audit-log";
import { createExpense, listExpenses, voidExpense } from "./expenses";
import { getBillingSummary } from "./billing";
import { listBranches } from "./people";

// Clinic-admin screens against the live database, as the clinic's own
// administrator (works on a database with or without the demo seed). Every
// write runs in a rolled-back transaction and table counts — including the
// audit trail — are compared afterwards, so nothing is left behind. Test rows
// are named "TEST …".

let admin: Client;
let adminCtx: TenantContext;
let stranger: TenantContext; // same clinic id, but no membership: RLS must refuse everything
let otherClinic: TenantContext; // the admin pinned to a clinic they don't belong to
let counts: Record<string, number>;

const n = async (sql: string) => Number((await admin.query(sql)).rows[0].n);
const tableCounts = async () => ({
  branches: await n(`SELECT count(*) n FROM branches`),
  departments: await n(`SELECT count(*) n FROM departments`),
  expenses: await n(`SELECT count(*) n FROM expenses`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  clinicsUpdatedAt: await n(`SELECT extract(epoch FROM max("updatedAt")) n FROM clinics`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
const dbRefusal = (p: Promise<unknown>) => p.then(() => "OK", (e: Error) => e.message);

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminCtx = await activeAdminContext(admin);
  stranger = { ...adminCtx, userId: randomUUID(), authUserId: `test-${randomUUID()}` };
  const other = (await admin.query(`SELECT id FROM clinics WHERE id <> $1 LIMIT 1`, [adminCtx.clinicId])).rows[0];
  otherClinic = { ...adminCtx, clinicId: other?.id ?? randomUUID() };
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("branches", () => {
  it("adds a branch with a generated code, edits it, and guards deactivation", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const created = await createBranch(adminCtx, { name: "TEST Baner Road", city: "Pune", address: "1 Test Lane", phone: "+91 98765 00001" }, tx);
      expect(created).toMatchObject({ name: "TEST Baner Road", status: "active", isHeadOffice: false });
      expect(created.code).toMatch(/^TBR(-\d+)?$/);
      expect((await listBranches(adminCtx, tx)).map((b) => b.id)).toContain(created.id);

      expect(await code(createBranch(adminCtx, { name: "test baner road", city: "Pune", address: "x", phone: "9876500002" }, tx))).toBe("DUPLICATE");
      expect(await code(createBranch(adminCtx, { name: "TEST Other", code: created.code, city: "Pune", address: "x", phone: "9876500002" }, tx))).toBe("DUPLICATE");

      const edited = await updateBranch(adminCtx, created.id, { city: "Mumbai", email: "baner@example.com" }, tx);
      expect(edited).toMatchObject({ city: "Mumbai", email: "baner@example.com", code: created.code });

      expect((await updateBranch(adminCtx, created.id, { status: "inactive" }, tx)).status).toBe("inactive");
      expect((await updateBranch(adminCtx, created.id, { status: "active" }, tx)).status).toBe("active");

      const head = (await listBranches(adminCtx, tx)).find((b) => b.isHeadOffice);
      if (head) expect(await code(updateBranch(adminCtx, head.id, { status: "inactive" }, tx))).toBe("INVALID_TRANSITION");
      expect(await code(updateBranch(adminCtx, "not-a-uuid", { city: "X" }, tx))).toBe("NOT_FOUND");
      expect(await code(updateBranch(adminCtx, randomUUID(), { city: "X" }, tx))).toBe("NOT_FOUND");

      // Audited, without values.
      const audit = await listAuditEvents(adminCtx, { area: "setup" }, tx);
      const mine = audit.items.filter((e) => e.action.startsWith("branches."));
      expect(mine.map((e) => e.summary)).toEqual(expect.arrayContaining(["Created a branch", "Updated a branch", "Changed the status of a branch"]));
      expect(JSON.stringify(audit.items)).not.toContain("Mumbai");
    });
  });

  it("RLS refuses branch writes for a non-member and across clinics", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(stranger);
      expect(await listBranches(stranger, tx)).toEqual([]);
      expect(await dbRefusal(createBranch({ ...stranger, branchId: null }, { name: "TEST X", city: "P", address: "A", phone: "9876500003" }, tx))).toMatch(/row-level security/);
    });
    await inRollback(async ({ tx, as }) => {
      await as(otherClinic);
      expect(await listBranches(otherClinic, tx)).toEqual([]);
    });
  });
});

describe("departments, specialties and the clinic profile", () => {
  it("creates clinic-wide and branch departments, blocks duplicates, edits and deactivates", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const specialty = (await listSpecialtyUsage(adminCtx, tx)).items[0];
      const branch = (await listBranches(adminCtx, tx)).find((b) => b.status === "active")!;
      const wide = await createDepartment(adminCtx, { name: "TEST General", specialtyId: specialty.id }, tx);
      expect(wide).toMatchObject({ branchId: null, branchName: null, specialtyName: specialty.name, status: "active", doctorCount: 0 });
      const local = await createDepartment(adminCtx, { name: "TEST General", branchId: branch.id }, tx);
      expect(local.branchName).toBe(branch.name);
      expect(await code(createDepartment(adminCtx, { name: "test general" }, tx))).toBe("DUPLICATE");
      expect(await code(createDepartment(adminCtx, { name: "TEST Bad", specialtyId: randomUUID() }, tx))).toBe("INVALID_INPUT");

      expect((await updateDepartment(adminCtx, wide.id, { description: "Walk-in care" }, tx)).description).toBe("Walk-in care");
      expect((await updateDepartment(adminCtx, wide.id, { status: "inactive" }, tx)).status).toBe("inactive");
      const page = await listDepartments(adminCtx, tx);
      expect(page.canManage).toBe(true);
      expect(page.items.map((d) => d.id)).toEqual(expect.arrayContaining([wide.id, local.id]));

      // Only active departments count towards a specialty.
      const usage = (await listSpecialtyUsage(adminCtx, tx)).items.find((s) => s.id === specialty.id)!;
      const before = (await admin.query(`SELECT count(*)::int n FROM departments WHERE "clinicId" = $1 AND "specialtyId" = $2 AND status = 'ACTIVE'`, [adminCtx.clinicId, specialty.id])).rows[0].n;
      expect(usage.departmentCount).toBe(before);
    });
  });

  it("reads and edits the clinic profile, reports capabilities and real usage", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const profile = await getClinicProfile(adminCtx, tx);
      expect(profile.canEdit).toBe(true);
      expect(profile.can).toEqual({ createBranch: true, updateBranch: true, manageDepartments: true });
      expect(profile.usage.branches).toBe((await listBranches(adminCtx, tx)).length);
      const updated = await updateClinicProfile(adminCtx, { city: "TEST City", pincode: "411001" }, tx);
      expect(updated).toMatchObject({ city: "TEST City", pincode: "411001", code: profile.code });
      expect(await code(updateClinicProfile(adminCtx, { code: "HACK" }, tx))).toBe("ZodError");
      const audit = await listAuditEvents(adminCtx, { area: "setup" }, tx);
      expect(audit.items[0]).toMatchObject({ action: "clinics.update", summary: "Updated the clinic profile", actorName: adminCtx.name });
      expect(audit.items[0].changed).toEqual(expect.arrayContaining(["city", "pincode"]));
    });
    await inRollback(async ({ tx, as }) => {
      await as(stranger);
      expect(await code(updateClinicProfile(stranger, { city: "TEST" }, tx))).not.toBe("OK");
    });
  });
});

describe("expenses", () => {
  it("records, totals and voids expenses; never edits or deletes them", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const branch = (await listBranches(adminCtx, tx)).find((b) => b.status === "active")!;
      const today = istTodayKey(new Date());
      const before = await listExpenses(adminCtx, {}, tx);

      const rent = await createExpense(adminCtx, { branchId: branch.id, category: "rent", description: "TEST rent", amount: 25000.5, date: today, paidTo: "TEST Landlord" }, tx);
      expect(rent).toMatchObject({ amount: 25000.5, status: "recorded", branchName: branch.name, recordedBy: adminCtx.name, category: "rent" });
      await createExpense(adminCtx, { branchId: branch.id, category: "utilities", description: "TEST power", amount: 1200, date: today }, tx);

      const after = await listExpenses(adminCtx, {}, tx);
      expect(after.monthTotal).toBeCloseTo(before.monthTotal + 26200.5, 2);
      expect(after.canManage).toBe(true);
      expect((await listExpenses(adminCtx, { search: "landlord" }, tx)).items.map((e) => e.id)).toEqual([rent.id]);
      expect((await listExpenses(adminCtx, { category: "utilities" }, tx)).items.every((e) => e.category === "utilities")).toBe(true);

      // The billing summary uses the same month total.
      expect((await getBillingSummary(adminCtx, tx)).totalExpensesThisMonth).toBeCloseTo(after.monthTotal, 2);

      const voided = await voidExpense(adminCtx, rent.id, { reason: "TEST entered twice" }, tx);
      expect(voided).toMatchObject({ status: "voided", voidReason: "TEST entered twice" });
      expect(await code(voidExpense(adminCtx, rent.id, { reason: "again" }, tx))).toBe("INVALID_TRANSITION");
      expect((await listExpenses(adminCtx, {}, tx)).monthTotal).toBeCloseTo(before.monthTotal + 1200, 2);
      expect((await listExpenses(adminCtx, { status: "voided" }, tx)).items.map((e) => e.id)).toContain(rent.id);

      // Validation.
      expect(await code(createExpense(adminCtx, { branchId: branch.id, category: "rent", description: "TEST", amount: 10, date: "2999-01-01" }, tx))).toBe("ZodError");
      expect(await code(createExpense(adminCtx, { branchId: randomUUID(), category: "rent", description: "TEST", amount: 10, date: today }, tx))).toBe("INVALID_INPUT");

    });
    // The database itself: amounts can't be changed and rows can't be deleted (each refusal aborts its transaction, so one per transaction).
    for (const attempt of ["update", "delete"] as const) {
      await inRollback(async ({ tx, as }) => {
        await as(adminCtx);
        const branch = (await listBranches(adminCtx, tx)).find((b) => b.status === "active")!;
        const e = await createExpense(adminCtx, { branchId: branch.id, category: "other", description: "TEST locked", amount: 5, date: istTodayKey(new Date()) }, tx);
        const sql = attempt === "update" ? tx.$executeRaw`UPDATE expenses SET "amountPaise" = 1 WHERE id = ${e.id}::uuid` : tx.$executeRaw`DELETE FROM expenses WHERE id = ${e.id}::uuid`;
        expect(await dbRefusal(sql)).toMatch(/permission denied/);
      });
    }
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const branch = (await listBranches(adminCtx, tx)).find((b) => b.status === "active")!;
      const e = await createExpense(adminCtx, { branchId: branch.id, category: "other", description: "TEST revive", amount: 5, date: istTodayKey(new Date()) }, tx);
      await voidExpense(adminCtx, e.id, { reason: "TEST" + " void" }, tx);
      const revived = await tx.$executeRaw`UPDATE expenses SET status = 'RECORDED', "voidReason" = NULL, "voidedAt" = NULL, "voidedByUserId" = NULL WHERE id = ${e.id}::uuid`;
      expect(revived).toBe(0); // RLS: only RECORDED rows are updatable
    });
  });

  it("RLS hides expenses from non-members and other clinics, and refuses their writes", async () => {
    let branchId = "";
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      branchId = (await listBranches(adminCtx, tx)).find((b) => b.status === "active")!.id;
      await createExpense(adminCtx, { branchId, category: "other", description: "TEST hidden", amount: 99, date: istTodayKey(new Date()) }, tx);
      await as(stranger);
      expect((await listExpenses(stranger, { search: "TEST hidden" }, tx)).items).toEqual([]);
      expect(await dbRefusal(createExpense(stranger, { branchId, category: "other", description: "TEST", amount: 1, date: istTodayKey(new Date()) }, tx))).toMatch(/row-level security|choose one of this clinic/i);
      await as(otherClinic);
      expect((await listExpenses(otherClinic, { search: "TEST hidden" }, tx)).items).toEqual([]);
    });
  });
});

describe("audit log", () => {
  it("is limited to the clinic and never exposes a failed sign-in's attempted email", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminCtx);
      const page = await listAuditEvents(adminCtx, { pageSize: 100 }, tx);
      expect(page.items.length).toBeLessThanOrEqual(100);
      for (const e of page.items) expect(e.actorName).not.toMatch(/@/);
      await as(stranger);
      expect((await listAuditEvents(stranger, {}, tx)).items).toEqual([]);
    });
  });
});

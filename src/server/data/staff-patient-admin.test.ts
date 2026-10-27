import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";

// Administrators editing, blocking and deleting staff and patients WITHOUT a
// database: a fake transaction records each call. Checks the permission gates,
// that only changed details are written (name and phone through the database
// functions), the last-administrator guard, that blocking a patient also
// switches off their portal access, and that deletes go only through the
// app.remove_* functions, whose refusals become clear messages.

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/tenant", () => ({
  withTenantDb: () => {
    throw new Error("no database in unit tests");
  },
}));

const { removeStaffMember, setStaffStatus, updateStaffDetails, updateStaffMember } = await import("./people");
const { removePatient, setPatientAccess } = await import("./patients");

const M = "55555555-5555-4555-8555-555555555555";
const B2 = "66666666-6666-4666-8666-666666666666";
const P = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-10-27T04:00:00.000Z");
const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  authUserId: "a", userId: "admin", email: "a@example.test", name: "Admin", clinicId: "c1", clinicName: "Aarogya", branchId: null,
  roles: ["ADMINISTRATOR"], permissions: new Set(["user.update", "user.disable", "staff.manage", "patient.view"]), doctorId: null, careScope: "clinic", ...over,
});

const patientRow = (over: Record<string, unknown> = {}) => ({
  id: P, clinicId: "c1", branchId: "b1", patientNumber: "AAR-P-0001", name: "Asha", dateOfBirth: new Date("1990-04-12"), gender: "FEMALE", phone: "+919876543210",
  email: null, bloodGroup: null, addressLine: null, city: null, allergies: [], chronicConditions: [], emergencyContactName: null, emergencyContactPhone: null,
  status: "ACTIVE", createdAt: NOW, userId: "pat-user", ...over,
});

function fakeTx(opts: { member?: Record<string, unknown> | null; otherAdmins?: number; branch?: boolean; sqlError?: string; removeResult?: string } = {}) {
  const sql: { text: string; values: unknown[] }[] = [];
  const tx = {
    clinicMembership: {
      findFirst: vi.fn(async () => (opts.member === undefined ? { id: M, userId: "staff-user", branchId: null, status: "ACTIVE", role: { key: "RECEPTIONIST" } } : opts.member)),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => opts.otherAdmins ?? 1),
    },
    branch: { findFirst: vi.fn(async () => (opts.branch === false ? null : { id: B2 })) },
    patient: {
      findFirst: vi.fn(async () => patientRow()),
      update: vi.fn(async (arg: { data: { status: string } }) => patientRow({ status: arg.data.status })),
    },
    appointment: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push({ text: strings.join("?"), values });
      if (opts.sqlError) throw new Error(opts.sqlError);
      // `ok`: the readiness check before a phone edit (app.set_staff_phone is installed).
      return [{ id: M, ok: true, result: opts.removeResult ?? "REMOVED" }];
    }),
  };
  return { tx: tx as unknown as TenantTx, raw: tx, sql };
}

describe("staff details", () => {
  it("writes only what changed: the branch on the membership, the name and phone through the database functions", async () => {
    const { tx, raw, sql } = fakeTx();
    await updateStaffDetails(ctx(), M, { name: "  Riya Sharma ", branchId: B2, phone: "+919812345678" }, tx);
    expect(raw.clinicMembership.update).toHaveBeenCalledWith({ where: { id: M }, data: { branchId: B2 } });
    const writes = sql.filter((q) => !q.text.includes("pg_proc")); // not the phone function's readiness check
    expect(writes.map((q) => q.text)).toEqual([expect.stringContaining("app.set_staff_name("), expect.stringContaining("app.set_staff_phone(")]);
    expect(sql[0].values).toEqual([M, "Riya Sharma"]);

    const name = fakeTx();
    await updateStaffMember(ctx(), M, { name: "Riya" }, name.tx);
    expect(name.raw.clinicMembership.update).not.toHaveBeenCalled();
    expect(name.sql).toHaveLength(1);
  });

  it("refuses bad input, other branches and missing permission; explains a shared account", async () => {
    await expect(updateStaffDetails(ctx(), M, {}, fakeTx().tx)).rejects.toThrow();
    await expect(updateStaffDetails(ctx(), M, { email: "x@y.z" }, fakeTx().tx)).rejects.toThrow();
    await expect(updateStaffDetails(ctx(), M, { branchId: B2 }, fakeTx({ branch: false }).tx)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateStaffDetails(ctx({ branchId: "b1" }), M, { branchId: B2 }, fakeTx({ member: { id: M, branchId: "b1" } }).tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaffDetails(ctx({ permissions: new Set(["staff.manage"]) }), M, { name: "Riya" }, fakeTx().tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaffDetails(ctx(), M, { name: "Riya" }, fakeTx({ sqlError: "staff admin: SHARED_ACCOUNT" }).tx)).rejects.toMatchObject({ code: "PHONE_LOCKED" });
  });

  it("never blocks the clinic's only active administrator", async () => {
    const admin = { id: M, userId: "other-admin", branchId: null, status: "ACTIVE", role: { key: "ADMINISTRATOR" } };
    await expect(setStaffStatus(ctx(), M, { status: "inactive" }, fakeTx({ member: admin, otherAdmins: 0 }).tx)).rejects.toMatchObject({ code: "CONFLICT" });
    const ok = fakeTx({ member: admin, otherAdmins: 1 });
    expect(await setStaffStatus(ctx(), M, { status: "inactive" }, ok.tx)).toEqual({ id: M, status: "inactive" });
  });

  it("deletes only through app.remove_staff_member and maps its refusals", async () => {
    const { tx, sql } = fakeTx();
    expect(await removeStaffMember(ctx(), M, tx)).toEqual({ id: M, removed: true });
    expect(sql[0].text).toContain("app.remove_staff_member(");
    expect(sql[0].values).toEqual([M]);
    await expect(removeStaffMember(ctx(), M, fakeTx({ sqlError: "staff admin: LAST_ADMIN" }).tx)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeStaffMember(ctx(), M, fakeTx({ sqlError: "staff admin: SELF" }).tx)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeStaffMember(ctx({ permissions: new Set(["user.update"]) }), M, fakeTx().tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("patients", () => {
  it("blocking makes the record inactive and switches off the patient's portal membership", async () => {
    const { tx, raw } = fakeTx();
    const p = await setPatientAccess(ctx(), P, { status: "blocked" }, tx, NOW);
    expect(p.status).toBe("inactive");
    expect(raw.clinicMembership.updateMany).toHaveBeenCalledWith({ where: { clinicId: "c1", userId: "pat-user", role: { key: "PATIENT" } }, data: { status: "INACTIVE" } });
    await expect(setPatientAccess(ctx({ permissions: new Set(["patient.view", "patient.update"]) }), P, { status: "blocked" }, fakeTx().tx, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deletes only a patient without history, through app.remove_patient", async () => {
    const { tx, sql } = fakeTx();
    expect(await removePatient(ctx(), P, tx)).toEqual({ id: P, removed: true });
    expect(sql[0].text).toContain("app.remove_patient(");
    await expect(removePatient(ctx(), P, fakeTx({ removeResult: "HAS_HISTORY" }).tx)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Block the patient instead/) });
    await expect(removePatient(ctx(), P, fakeTx({ sqlError: "function app.remove_patient(uuid) does not exist" }).tx)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";

// Suspending and deleting a doctor WITHOUT a database: a fake transaction
// records each call. Checks the permission gate, that suspending changes both
// the profile and the doctor's membership, that an admin can't act on their
// own profile, and that deleting goes only through app.remove_doctor, whose
// refusals become clear messages.

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/tenant", () => ({
  withTenantDb: () => {
    throw new Error("no database in unit tests");
  },
}));

const { removeDoctor, setDoctorStatus } = await import("./people");

const DOC = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-27T04:00:00.000Z");
const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  authUserId: "a", userId: "admin", email: "a@example.test", name: "Admin", clinicId: "c1", clinicName: "Aarogya", branchId: null,
  roles: ["ADMINISTRATOR"], permissions: new Set(["doctor.manage"]), doctorId: null, careScope: "clinic", ...over,
});

function fakeTx(opts: { doctor?: { id: string; userId: string } | null; upcoming?: number; removeResult?: string; removeError?: string } = {}) {
  const sql: { text: string; values: unknown[] }[] = [];
  const tx = {
    doctorProfile: {
      findFirst: vi.fn(async () => (opts.doctor === undefined ? { id: DOC, userId: "doc-user" } : opts.doctor)),
      update: vi.fn(async () => ({})),
    },
    clinicMembership: { updateMany: vi.fn(async () => ({ count: 1 })) },
    appointment: { count: vi.fn(async () => opts.upcoming ?? 0) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push({ text: strings.join("?"), values });
      if (opts.removeError) throw new Error(opts.removeError);
      return [{ result: opts.removeResult ?? "REMOVED" }];
    }),
  };
  return { tx: tx as unknown as TenantTx, raw: tx, sql };
}

describe("setDoctorStatus", () => {
  it("suspends the profile and the doctor's membership, and reports upcoming appointments", async () => {
    const { tx, raw } = fakeTx({ upcoming: 3 });
    expect(await setDoctorStatus(ctx(), DOC, { status: "inactive" }, tx, NOW)).toEqual({ id: DOC, status: "inactive", upcomingAppointments: 3 });
    expect(raw.doctorProfile.update).toHaveBeenCalledWith({ where: { id: DOC }, data: { status: "INACTIVE" } });
    expect(raw.clinicMembership.updateMany).toHaveBeenCalledWith({ where: { clinicId: "c1", userId: "doc-user", role: { key: "DOCTOR" } }, data: { status: "INACTIVE" } });
    const { tx: tx2, raw: raw2 } = fakeTx();
    await setDoctorStatus(ctx(), DOC, { status: "active" }, tx2, NOW);
    expect(raw2.clinicMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ACTIVE" } }));
  });

  it("refuses without doctor.manage, bad input, another clinic's doctor and the admin's own profile", async () => {
    const { tx, raw } = fakeTx();
    await expect(setDoctorStatus(ctx({ permissions: new Set(["doctor.view"]) }), DOC, { status: "inactive" }, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setDoctorStatus(ctx(), DOC, { status: "blocked" }, tx)).rejects.toThrow();
    await expect(setDoctorStatus(ctx(), "nope", { status: "inactive" }, tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setDoctorStatus(ctx(), DOC, { status: "inactive" }, fakeTx({ doctor: null }).tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setDoctorStatus(ctx(), DOC, { status: "inactive" }, fakeTx({ doctor: { id: DOC, userId: "admin" } }).tx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(raw.doctorProfile.update).not.toHaveBeenCalled();
  });
});

describe("removeDoctor", () => {
  it("deletes only through app.remove_doctor, with nothing but the doctor id", async () => {
    const { tx, sql } = fakeTx();
    expect(await removeDoctor(ctx(), DOC, tx)).toEqual({ id: DOC, removed: true });
    expect(sql).toHaveLength(1);
    expect(sql[0].text).toContain("app.remove_doctor(");
    expect(sql[0].values).toEqual([DOC]);
  });

  it("explains a doctor with patient history, and maps the database's refusals", async () => {
    await expect(removeDoctor(ctx(), DOC, fakeTx({ removeResult: "HAS_HISTORY" }).tx)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Suspend the doctor instead/) });
    await expect(removeDoctor(ctx(), DOC, fakeTx({ removeError: "doctor remove: SELF" }).tx)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeDoctor(ctx(), DOC, fakeTx({ removeError: "doctor remove: NOT_FOUND" }).tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeDoctor(ctx(), DOC, fakeTx({ removeError: "function app.remove_doctor(uuid) does not exist" }).tx)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await expect(removeDoctor(ctx({ permissions: new Set() }), DOC, fakeTx().tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

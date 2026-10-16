import { describe, expect, it } from "vitest";
import {
  auditActionPrefixes,
  auditArea,
  auditSummary,
  branchCodeFromName,
  branchInputSchema,
  branchPatchSchema,
  clinicProfileSchema,
  departmentInputSchema,
  expenseInputSchema,
  isUuid,
  monthStart,
  nextFreeCode,
  rupeesToPaise,
  voidExpenseSchema,
} from "./clinic-admin-rules";

const BRANCH = "6f1c1f9e-2b9b-4a63-9d7e-0d1f0b8f2a11";

describe("branches", () => {
  it("codes come from the name and never collide", () => {
    expect(branchCodeFromName("Baner Road")).toBe("BR");
    expect(branchCodeFromName("Kothrud")).toBe("KOT");
    expect(branchCodeFromName("Aundh – East Wing 2")).toBe("AEW2");
    expect(branchCodeFromName("K")).toBe("KB");
    expect(nextFreeCode("BR", new Set(["BR", "BR-2"]))).toBe("BR-3");
    expect(nextFreeCode("KOT", new Set())).toBe("KOT");
  });

  it("validates input: required fields, phone, optional email and code", () => {
    const ok = branchInputSchema.parse({ name: " Baner ", city: "Pune", address: "12 Main Rd", phone: "+91 98765 43210", email: "", code: "" });
    expect(ok).toMatchObject({ name: "Baner", email: null, code: undefined });
    expect(branchInputSchema.parse({ name: "B", city: "P", address: "A", phone: "020-1234567", code: "bnr-1" }).code).toBe("BNR-1");
    expect(() => branchInputSchema.parse({ name: "B", city: "P", address: "A", phone: "abc" })).toThrow();
    expect(() => branchInputSchema.parse({ name: "", city: "P", address: "A", phone: "9876543210" })).toThrow();
    expect(() => branchInputSchema.parse({ name: "B", city: "P", address: "A", phone: "9876543210", code: "a b" })).toThrow();
  });

  it("a patch is either a status change or a details edit, never both, never the code", () => {
    expect(branchPatchSchema.parse({ status: "inactive" })).toEqual({ status: "inactive" });
    expect(branchPatchSchema.parse({ city: "Mumbai" })).toEqual({ city: "Mumbai" });
    expect(() => branchPatchSchema.parse({ status: "inactive", city: "Mumbai" })).toThrow();
    expect(() => branchPatchSchema.parse({ code: "NEW" })).toThrow();
    expect(() => branchPatchSchema.parse({})).toThrow();
  });
});

describe("departments and clinic profile", () => {
  it("departments are clinic-wide unless a branch is given", () => {
    expect(departmentInputSchema.parse({ name: "Paediatrics" })).toEqual({ name: "Paediatrics", description: null, branchId: null, specialtyId: null });
    expect(departmentInputSchema.parse({ name: "ENT", branchId: BRANCH, description: "  " }).branchId).toBe(BRANCH);
    expect(() => departmentInputSchema.parse({ name: "ENT", branchId: "not-a-uuid" })).toThrow();
  });

  it("the clinic profile accepts only its own fields, with a 6-digit PIN", () => {
    expect(clinicProfileSchema.parse({ name: "Aarogya", pincode: "411038" })).toEqual({ name: "Aarogya", pincode: "411038" });
    expect(() => clinicProfileSchema.parse({ pincode: "011038" })).toThrow();
    expect(() => clinicProfileSchema.parse({ code: "X" })).toThrow();
    expect(() => clinicProfileSchema.parse({ status: "ACTIVE" })).toThrow();
    expect(() => clinicProfileSchema.parse({})).toThrow();
  });

  it("malformed path ids are rejected before reaching the database", () => {
    expect(isUuid(BRANCH)).toBe(true);
    expect(isUuid("1; DROP TABLE x")).toBe(false);
  });
});

describe("audit log", () => {
  it("summaries come from the action key only", () => {
    expect(auditSummary("branches.insert", "SUCCESS")).toBe("Created a branch");
    expect(auditSummary("branches.update", "SUCCESS", ["status"])).toBe("Changed the status of a branch");
    expect(auditSummary("clinics.update", "SUCCESS", ["name", "phone"])).toBe("Updated the clinic profile");
    expect(auditSummary("expenses.update", "SUCCESS", ["status", "voidReason"])).toBe("Updated an expense");
    expect(auditSummary("auth.sign_in", "SUCCESS")).toBe("Signed in");
    expect(auditSummary("auth.sign_in", "FAILURE")).toBe("Signed in (failed)");
    expect(auditSummary("access.denied", "DENIED")).toBe("Was denied access");
    expect(auditSummary("something.else", "SUCCESS")).toBe("something.else");
  });

  it("areas group actions, and filter by action prefix", () => {
    expect(auditArea("auth.sign_out")).toBe("sign_in");
    expect(auditArea("expenses.insert")).toBe("billing");
    expect(auditArea("departments.update")).toBe("setup");
    expect(auditArea("weird")).toBe("other");
    expect(auditActionPrefixes("setup").sort()).toEqual(["branches.", "clinics.", "departments."]);
    expect(auditActionPrefixes("sign_in")).toEqual(["auth."]);
  });
});

describe("expenses", () => {
  const schema = expenseInputSchema("2026-10-16");
  const base = { branchId: BRANCH, category: "rent", description: "October rent", amount: 25000, date: "2026-10-01" };

  it("amounts are positive rupees with at most two decimals, stored as paise", () => {
    expect(schema.parse({ ...base, amount: 1234.5 }).amount).toBe(1234.5);
    expect(rupeesToPaise(1234.5)).toBe(123450);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    for (const amount of [0, -5, 1.234, Number.NaN, 30_000_000]) expect(() => schema.parse({ ...base, amount })).toThrow();
  });

  it("dates are real calendar days, not in the future (IST)", () => {
    expect(schema.parse({ ...base, date: "2026-10-16" }).date).toBe("2026-10-16");
    for (const date of ["2026-10-17", "2026-02-30", "16-10-2026", "1999-12-31"]) expect(() => schema.parse({ ...base, date })).toThrow();
  });

  it("category must be known; optional text is trimmed to null", () => {
    expect(schema.parse({ ...base, paidTo: "  ", reference: " INV-9 " })).toMatchObject({ paidTo: null, reference: "INV-9" });
    expect(() => schema.parse({ ...base, category: "bribes" })).toThrow();
  });

  it("voiding needs a reason; the month starts on the 1st", () => {
    expect(() => voidExpenseSchema.parse({ reason: "x" })).toThrow();
    expect(voidExpenseSchema.parse({ reason: " Entered twice " }).reason).toBe("Entered twice");
    expect(monthStart("2026-10-16")).toBe("2026-10-01");
  });
});

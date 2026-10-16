import { describe, expect, it } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import {
  isRedeemResult,
  issueLinkCodeSchema,
  LINK_CODE_PATTERN,
  mapPatientLinkDbError,
  REDEEM_MESSAGES,
  redeemLinkCodeSchema,
} from "./patient-link-rules";

// P6.4 linking-code rules. The database (migration 20261022000000) is the
// authority; these are the request shapes and the error mapping in front of it.

const dbError = (message: string) => Object.assign(new Error("Raw query failed"), { cause: new Error(message) });
const mapped = (err: unknown) => {
  try {
    mapPatientLinkDbError(err);
  } catch (e) {
    return e;
  }
};

describe("request shapes", () => {
  it("issuing requires the explicit identity confirmation and nothing else", () => {
    expect(issueLinkCodeSchema.parse({ identityVerified: true })).toEqual({ identityVerified: true });
    for (const bad of [{}, { identityVerified: false }, { identityVerified: "true" }, { identityVerified: true, patientId: "x" }, { identityVerified: true, clinicId: "x" }]) {
      expect(issueLinkCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("redeeming accepts the code only — a browser can't choose the patient or clinic", () => {
    expect(redeemLinkCodeSchema.parse({ code: "abcd efgh" })).toEqual({ code: "abcd efgh" });
    for (const bad of [{}, { code: 123 }, { code: "x".repeat(65) }, { code: "A", patientId: "p" }, { code: "A", clinicId: "c" }, { code: "A", userId: "u" }]) {
      expect(redeemLinkCodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the display pattern is 4×4 Crockford base32 (no I, L, O, U)", () => {
    expect(LINK_CODE_PATTERN.test("0A1B-2C3D-4E5F-6G7H")).toBe(true);
    for (const bad of ["0A1B2C3D4E5F6G7H", "0A1B-2C3D-4E5F-6G7I", "0A1B-2C3D-4E5F-6G7U", "0a1b-2c3d-4e5f-6g7h", "0A1B-2C3D-4E5F"]) expect(LINK_CODE_PATTERN.test(bad), bad).toBe(false);
  });

  it("knows exactly the five database results", () => {
    for (const r of ["LINKED", "ALREADY_LINKED", "INVALID", "NOT_ELIGIBLE", "RATE_LIMITED"]) expect(isRedeemResult(r)).toBe(true);
    for (const r of ["linked", "OK", "", null, 1]) expect(isRedeemResult(r)).toBe(false);
  });

  it("one generic message for every unusable code, revealing nothing about the record", () => {
    expect(REDEEM_MESSAGES.INVALID).toMatch(/isn't valid or has expired/);
    for (const m of Object.values(REDEEM_MESSAGES)) expect(m).not.toMatch(/patient (number|record) \w|already linked to|another account|revoked|was used|already used/i);
  });
});

describe("database refusals", () => {
  it("maps permission and scope refusals to auth errors (another clinic's patient is NOT_FOUND)", () => {
    expect(mapped(dbError("patient link: NOT_PERMITTED"))).toMatchObject({ name: "AuthError", code: "FORBIDDEN" });
    expect(mapped(dbError("patient link: NOT_FOUND"))).toMatchObject({ name: "AuthError", code: "NOT_FOUND" });
    expect(mapped(dbError("patient link: NOT_FOUND"))).toBeInstanceOf(AuthError);
  });

  it("maps business refusals to friendly API errors", () => {
    expect(mapped(dbError("patient link: ALREADY_LINKED"))).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(mapped(dbError("patient link: RATE_LIMITED"))).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(mapped(dbError("patient link: IDENTITY_NOT_CONFIRMED"))).toMatchObject({ code: "INVALID_INPUT" });
    expect(mapped(dbError("patient link: PATIENT_INACTIVE"))).toBeInstanceOf(DataError);
    expect(mapped(dbError("function app.issue_patient_link_code(uuid, boolean) does not exist"))).toMatchObject({ code: "FEATURE_UNAVAILABLE" });
  });

  it("rethrows anything it doesn't recognise", () => {
    const other = new Error("connection reset");
    expect(mapped(other)).toBe(other);
    const unknownCode = dbError("patient link: SOMETHING_NEW");
    expect(mapped(unknownCode)).toBe(unknownCode);
  });
});

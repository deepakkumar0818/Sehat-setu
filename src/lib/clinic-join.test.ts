import { describe, expect, it } from "vitest";
import { joinClinicPath, normalizeClinicCode, registerForClinicPath } from "./clinic-join";

describe("clinic patient link", () => {
  it("accepts 2–10 letters or digits, upper-cased", () => {
    expect(normalizeClinicCode(" aar ")).toBe("AAR");
    expect(normalizeClinicCode("CLINIC2026")).toBe("CLINIC2026");
    for (const bad of ["A", "ABCDEFGHIJK", "A-R", "a b", "../x", "", null, undefined, 12]) expect(normalizeClinicCode(bad)).toBeNull();
  });

  it("builds the join and register paths", () => {
    expect(joinClinicPath("AAR")).toBe("/join/AAR");
    expect(registerForClinicPath("AAR")).toBe("/register?clinic=AAR");
  });
});

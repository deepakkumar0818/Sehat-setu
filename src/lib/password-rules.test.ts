import { describe, expect, it } from "vitest";
import { newPasswordProblem, passwordStrength } from "./password-rules";

describe("new password rules", () => {
  it("accepts a long, unpredictable password", () => {
    expect(newPasswordProblem("Monsoon-Kettle-48")).toBeNull();
    expect(newPasswordProblem("correct horse battery staple")).toBeNull();
  });

  it("refuses short, too-long, padded, reused and obvious passwords", () => {
    expect(newPasswordProblem("Short1!")).toMatch(/at least 12/);
    expect(newPasswordProblem("a".repeat(20) + "€".repeat(20))).toMatch(/at most 72/); // bcrypt counts bytes
    expect(newPasswordProblem(" Monsoon-Kettle-48")).toMatch(/space/);
    expect(newPasswordProblem("Monsoon-Kettle-48", { current: "Monsoon-Kettle-48" })).toMatch(/different/);
    expect(newPasswordProblem("aaaaaaaaaaaaaa")).toMatch(/too easy/);
    expect(newPasswordProblem("MyPassword2026!")).toMatch(/common word/);
    expect(newPasswordProblem("Sehat-Setu-2026x")).toMatch(/common word/);
    expect(newPasswordProblem("deepak-Kettle-48", { email: "deepak@x.in" })).toMatch(/email/);
  });

  it("strength meter", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("monsoonkettle")).toBe(1);
    expect(passwordStrength("Monsoon-Kettle-48")).toBe(4);
  });
});

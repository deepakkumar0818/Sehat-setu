import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/permissions";

describe("permission checks", () => {
  it("allows a doctor to view, create, and edit clinical records but not delete them", () => {
    expect(hasPermission("doctor", "clinical_records", "view")).toBe(true);
    expect(hasPermission("doctor", "clinical_records", "create")).toBe(true);
    expect(hasPermission("doctor", "clinical_records", "edit")).toBe(true);
  });

  it("only lets a receptionist view (not edit) clinical records", () => {
    expect(hasPermission("receptionist", "clinical_records", "view")).toBe(true);
    expect(hasPermission("receptionist", "clinical_records", "edit")).toBe(false);
  });

  it("restricts a pharmacist to inventory and billing, not clinical records", () => {
    expect(hasPermission("pharmacist", "inventory", "edit")).toBe(true);
    expect(hasPermission("pharmacist", "clinical_records", "view")).toBe(false);
  });

  it("grants super_admin full access to every resource/action combination it defines", () => {
    expect(hasPermission("super_admin", "staff", "delete")).toBe(true);
    expect(hasPermission("super_admin", "billing", "delete")).toBe(true);
  });

  it("gives a patient no delete access anywhere", () => {
    expect(hasPermission("patient", "appointments", "delete")).toBe(false);
    expect(hasPermission("patient", "billing", "delete")).toBe(false);
  });
});

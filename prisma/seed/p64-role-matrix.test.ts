import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_BY_KEY } from "../../src/data/permission-catalog";
import { buildDemoData, demoId } from "./demo-data";

// P6.4: the approved holders of patient.portal_link (Administrator, Receptionist)
// live in migration 20261022000000_patient_link_codes. The seed builds grants from
// src/data/permission-catalog.ts, so a reseed must produce exactly the same
// holders — this test reads the migration itself, so neither side can drift.
const sql = readFileSync(path.resolve(import.meta.dirname, "../migrations/20261022000000_patient_link_codes/migration.sql"), "utf8");
const text = (name: string) => new RegExp(`${name}[ ]+constant (?:uuid|text) := '((?:[^']|'')*)';`).exec(sql)![1].replaceAll("''", "'");
const GRANTS: Record<string, string[]> = JSON.parse(/c_grants constant jsonb := '([\s\S]*?)';/.exec(sql)![1]);

const data = buildDemoData(new Date("2026-10-14T06:30:00Z"));
const roleKey = new Map(data.roles.map((r) => [r.id, r.key as string]));
const permKey = new Map(data.permissions.map((p) => [p.id, p.key]));
const holders = (key: string) =>
  data.rolePermissions.filter((rp) => permKey.get(rp.permissionId) === key).map((rp) => roleKey.get(rp.roleId)!).sort();

describe("P6.4 role matrix: seed/catalogue == migration 20261022000000", () => {
  it("the new permission row matches the migration exactly (id, name, module, description)", () => {
    const key = text("c_key");
    expect(key).toBe("patient.portal_link");
    expect(demoId(`permission:${key}`)).toBe(text("c_id"));
    expect(PERMISSION_BY_KEY[key]).toEqual({ key, name: text("c_name"), module: text("c_mod"), description: text("c_desc") });
  });

  it("is held by exactly Administrator and Receptionist", () => {
    expect(GRANTS).toEqual({ "patient.portal_link": ["ADMINISTRATOR", "RECEPTIONIST"] });
    expect(holders("patient.portal_link")).toEqual(["ADMINISTRATOR", "RECEPTIONIST"]);
  });

  it("doctors, nurses, clinic managers and patients can't issue codes", () => {
    for (const role of ["DOCTOR", "NURSE", "CLINIC_MANAGER", "PATIENT"]) expect(holders("patient.portal_link")).not.toContain(role);
  });
});

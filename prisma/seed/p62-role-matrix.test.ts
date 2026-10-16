import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_BY_KEY } from "../../src/data/permission-catalog";
import { buildDemoData, demoId } from "./demo-data";

// The approved P6.2 role matrix lives in migration 20261021000000_patient_documents
// (c_new / c_grants). The seed builds grants from src/data/permission-catalog.ts, so
// a reseed must produce exactly the same holders — this test reads the migration
// itself, so neither side can drift silently.
const sql = readFileSync(path.resolve(import.meta.dirname, "../migrations/20261021000000_patient_documents/migration.sql"), "utf8");
const constant = (name: string) => JSON.parse(new RegExp(`${name} constant jsonb := '([\\s\\S]*?)';`).exec(sql)![1]);
const NEW: { id: string; key: string; name: string; module: string; description: string }[] = constant("c_new");
const GRANTS: Record<string, string[]> = constant("c_grants");

const data = buildDemoData(new Date("2026-10-14T06:30:00Z"));
const roleKey = new Map(data.roles.map((r) => [r.id, r.key as string]));
const permKey = new Map(data.permissions.map((p) => [p.id, p.key]));
const holders = (key: string) =>
  data.rolePermissions.filter((rp) => permKey.get(rp.permissionId) === key).map((rp) => roleKey.get(rp.roleId)!).sort();

describe("P6.2 role matrix: seed/catalogue == migration 20261021000000", () => {
  it("the new permission rows match the migration exactly (id, name, module, description)", () => {
    for (const p of NEW) {
      expect(demoId(`permission:${p.key}`)).toBe(p.id);
      expect(PERMISSION_BY_KEY[p.key]).toEqual({ key: p.key, name: p.name, module: p.module, description: p.description });
    }
  });

  it.each(Object.keys(GRANTS))("%s is held by exactly the approved roles", (key) => {
    expect(holders(key)).toEqual([...GRANTS[key]].sort());
  });

  it("clinic managers and receptionists get no clinical read permissions", () => {
    for (const key of ["lab_report.view", "medical_record.view", "medical_record.manage", "lab.manage", "patient.medical_record.view"]) {
      expect(holders(key)).not.toContain("CLINIC_MANAGER");
      expect(holders(key)).not.toContain("RECEPTIONIST");
    }
  });
});

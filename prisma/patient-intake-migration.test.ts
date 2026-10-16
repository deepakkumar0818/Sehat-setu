import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static checks of migration 20261023000000_patient_intake (P6.5 onboarding).
// It has NOT been applied to any database; these tests read the SQL only.

const sql = readFileSync(path.resolve(import.meta.dirname, "migrations/20261023000000_patient_intake/migration.sql"), "utf8");
/** The SQL outside function bodies ($$ … $$), without comments. */
const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$").replace(/--[^\n]*/g, "");
const bodies = [...sql.matchAll(/CREATE FUNCTION (app\.\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$/g)].map((m) => ({ name: m[1], body: m[2].replace(/--[^\n]*/g, "") }));
const fn = (name: string) => bodies.find((b) => b.name === name)!.body;
const ENTRY_POINTS = ["app.save_patient_intake_personal", "app.save_patient_intake_medical", "app.skip_patient_intake_medical", "app.submit_patient_symptom_report", "app.complete_patient_intake"];

describe("patient intake migration: additive, no existing data or rules touched", () => {
  it("creates only new types, tables, indexes, policies, triggers and functions", () => {
    expect(topLevel).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|TRUNCATE|DROP)\b/im);
    expect(topLevel).not.toMatch(/CREATE OR REPLACE/i);
    for (const m of topLevel.matchAll(/ALTER TABLE "?(\w+)"? ([^;]+);/g)) {
      expect(["patient_intake_profiles", "patient_symptom_reports"]).toContain(m[1]);
      expect(m[2]).toBe("ENABLE ROW LEVEL SECURITY");
    }
    for (const m of topLevel.matchAll(/CREATE (?:POLICY \w+|TRIGGER \w+ [^;]*?) ON "?(\w+)"?/g)) expect(["patient_intake_profiles", "patient_symptom_reports"]).toContain(m[1]);
  });

  it("the runtime role can only SELECT the new tables and EXECUTE the five entry points", () => {
    const grants = [...topLevel.matchAll(/GRANT ([\s\S]+?) TO sehat_app;/g)].map((m) => m[1].replace(/\s+/g, " "));
    expect(grants).toHaveLength(3);
    expect(grants[0]).toBe("SELECT ON patient_intake_profiles, patient_symptom_reports");
    expect(grants[1]).toBe("EXECUTE ON FUNCTION app.patient_reported_visible(uuid)"); // used by the read policies
    expect(grants[2]).toMatch(/^EXECUTE ON FUNCTION /);
    for (const name of ENTRY_POINTS) expect(grants[2]).toContain(name);
    expect(grants.join(" ")).not.toMatch(/intake_current_patient|intake_items_valid|intake_e164/);
    expect(topLevel).not.toMatch(/GRANT [^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]* TO/);
    expect(topLevel).toMatch(/REVOKE ALL ON patient_intake_profiles, patient_symptom_reports FROM PUBLIC, anon, authenticated;/);
  });

  it("RLS read policies: own rows (current_patient_ids) or staff under the medical-record rules", () => {
    for (const table of ["patient_intake_profiles", "patient_symptom_reports"]) {
      const policy = new RegExp(`CREATE POLICY ${table}_read ON ${table} FOR SELECT TO sehat_app USING \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
      expect(policy).toMatch(/"clinicId" = \(SELECT app\.current_clinic_id\(\)\)\s+AND/);
      expect(policy).toContain("app.current_patient_ids()");
      expect(policy).toContain('app.patient_reported_visible("patientId")');
      expect(policy).not.toMatch(/staff_can/);
    }
  });

  it("staff visibility: medical_record.view/manage within branch scope, or an assigned doctor — never basic-info, lab or nursing permissions", () => {
    const body = fn("app.patient_reported_visible");
    expect(body).toMatch(/app\.is_staff_member\(\)/);
    expect(body).toMatch(/p\."clinicId" = app\.current_clinic_id\(\)/);
    expect(body).toMatch(/staff_can\(ARRAY\['medical_record\.view', 'medical_record\.manage'\]\) AND app\.branch_visible\(p\."branchId"\)/);
    expect(body).toMatch(/app\.current_doctor_id\(\) IS NOT NULL AND app\.staff_can\(ARRAY\['patient\.medical_record\.view'\]\)[\s\S]*a\."doctorId" = app\.current_doctor_id\(\)/);
    expect(body).not.toMatch(/basic_info|lab_report|patient\.view|vitals/);
  });

  it("a date of birth can't be in the future in the application's time zone (IST)", () => {
    expect(fn("app.save_patient_intake_personal")).toContain("p_date_of_birth > (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date");
  });
});

describe("functions: the patient comes from the session, never a parameter", () => {
  it("every entry point is SECURITY DEFINER with an empty search_path and resolves the caller via intake_current_patient()", () => {
    for (const name of ENTRY_POINTS) {
      const decl = new RegExp(`CREATE FUNCTION ${name.replace(".", "\\.")}\\([\\s\\S]*?AS\\s*\\n\\$\\$`).exec(sql)![0];
      expect(decl, name).toMatch(/SECURITY DEFINER SET search_path = ''/);
      expect(decl, name).not.toMatch(/p_patient_id|p_clinic_id|p_user_id/);
      expect(fn(name), name).toContain("app.intake_current_patient()");
    }
    expect(fn("app.intake_current_patient")).toMatch(/app\.current_patient_ids\(\)[\s\S]*cardinality\(v_ids\) <> 1[\s\S]*p\.status = 'ACTIVE'/);
  });

  it("never links, never grants membership and never edits the clinic's records", () => {
    for (const { name, body } of bodies) {
      expect(body, name).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(patients|clinic_memberships|users|appointments|consultations|prescriptions|patient_link_codes)\b/);
      expect(body, name).not.toMatch(/"userId"\s*=/);
    }
  });

  it("symptom reports are append-only, idempotent per request id, rate-limited, and only for the caller's own upcoming appointment", () => {
    const body = fn("app.submit_patient_symptom_report");
    expect(body).not.toMatch(/UPDATE public\.patient_symptom_reports/);
    expect(body).toMatch(/ON CONFLICT \("patientId", "requestId"\) DO NOTHING/);
    expect(body).toMatch(/a\.id = p_appointment_id AND a\."clinicId" = v_clinic AND a\."patientId" = v_patient/);
    expect(body).toMatch(/a\.status IN \('SCHEDULED', 'CONFIRMED'\)/);
    expect(body).toMatch(/>= 20 THEN/);
    expect(sql).toMatch(/CONSTRAINT "patient_symptom_reports_request_key" UNIQUE \("patientId", "requestId"\)/);
  });

  it("allergy status is explicit and consistent with the list", () => {
    expect(sql).toMatch(/CREATE TYPE "IntakeAllergyStatus" AS ENUM \('NOT_ANSWERED', 'UNKNOWN', 'NONE_KNOWN', 'HAS_ALLERGIES'\)/);
    expect(sql).toMatch(/\("allergyStatus" = 'HAS_ALLERGIES'\) = \(pg_catalog\.jsonb_array_length\("allergies"\) > 0\)/);
  });

  it("completion needs the personal step only; skipping medical history changes no answers", () => {
    expect(fn("app.complete_patient_intake")).toMatch(/PERSONAL_FIRST/);
    expect(fn("app.skip_patient_intake_medical")).not.toMatch(/allergies|medications|conditions/);
  });

  it("audit events carry ids and flags only — no names, dates of birth, phones or clinical answers", () => {
    for (const m of sql.matchAll(/app\.log_event\(([^;]*?)\);/g)) {
      expect(m[1]).not.toMatch(/v_name|p_legal_name|p_date_of_birth|p_phone|p_allergies|p_medications|v_reason|v_symptoms|v_notes|p_conditions/);
    }
  });
});

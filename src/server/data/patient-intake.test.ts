import { describe, expect, it, vi } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import type { PatientContext } from "@/server/auth/authorize";

vi.mock("server-only", () => ({}));
vi.mock("@/server/prisma", () => ({ prisma: {} }));

const { completeIntake, getIntakeState, getPatientReportedForStaff, isMissingIntakeSchema, mapIntakeDbError, saveIntakeMedical, saveIntakePersonal, submitSymptomReport } = await import("./patient-intake");
import type { TenantContext } from "@/server/auth/authorize";

// The data module against a fake transaction (no database): what it asks the
// database, with which values, and how refusals are mapped. The SQL functions
// themselves are checked in prisma/patient-intake-migration.test.ts.

const CTX: PatientContext = { authUserId: "auth-1", userId: "user-1", email: "zztest@example.com", name: "ZZTEST", clinicId: "clinic-1", clinicName: "ZZTEST Clinic", patientIds: ["patient-1"] };
const NOW = new Date("2026-10-14T10:00:00Z");

type Call = { sql: string; values: unknown[] };
function fakeTx(over: { schema?: boolean; profile?: unknown; record?: unknown; appointments?: unknown[]; raise?: Error } = {}) {
  const calls: Call[] = [];
  const where: Record<string, unknown> = {};
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      calls.push({ sql, values });
      if (/to_regclass/.test(sql)) return [{ ok: over.schema ?? true }];
      if (over.raise) throw over.raise;
      if (/submit_patient_symptom_report/.test(sql)) return [{ report_id: "r-1", appointment_id: values[1] ?? null, created: true }];
      return [{}];
    }),
    patientIntakeProfile: { findFirst: vi.fn(async (a: { where: unknown }) => ((where.profile = a.where), over.profile ?? null)) },
    patient: { findFirst: vi.fn(async (a: { where: unknown }) => ((where.record = a.where), over.record ?? null)), findMany: vi.fn(async () => []) },
    appointment: { findMany: vi.fn(async (a: { where: unknown }) => ((where.appointments = a.where), over.appointments ?? [])) },
    patientSymptomReport: { count: vi.fn(async (a: { where: unknown }) => ((where.reports = a.where), 2)) },
    branch: { findMany: vi.fn(async () => [{ id: "branch-1", name: "ZZTEST Branch" }]) },
    doctorProfile: { findMany: vi.fn(async () => [{ id: "doctor-1", userId: "doc-user-1" }]) },
    user: { findMany: vi.fn(async () => [{ id: "doc-user-1", name: "Dr ZZTEST" }]) },
  };
  return { tx: tx as never, calls, where };
}

describe("getIntakeState", () => {
  it("is unavailable (not an error) until the migration is applied", async () => {
    const { tx, calls } = fakeTx({ schema: false });
    expect(await getIntakeState(CTX, tx, NOW)).toEqual({ available: false });
    expect(calls).toHaveLength(1);
  });

  it("reads only this patient's rows in this clinic (ids from the session), and resumes from saved progress", async () => {
    const profile = {
      legalName: "ZZTEST Patient", dateOfBirth: new Date("1990-05-17T00:00:00Z"), gender: null, phone: "+919800000001", addressLine: "1 ZZTEST Rd", city: "Pune",
      state: null, postalCode: null, emergencyContactName: null, emergencyContactRelationship: null, emergencyContactPhone: null,
      allergyStatus: "NONE_KNOWN", allergies: [], medications: [{ name: "Metformin", dose: null, frequency: null }], conditions: [], pastSurgeries: null, familyHistory: null,
      medicalReviewedAt: null, completedAt: null,
    };
    const { tx, where } = fakeTx({ profile, appointments: [{ id: "appt-1", startsAt: new Date("2026-10-15T04:30:00Z"), branchId: "branch-1", doctorId: "doctor-1" }] });
    const s = await getIntakeState(CTX, tx, NOW);
    expect(where.profile).toEqual({ clinicId: "clinic-1", patientId: { in: ["patient-1"] } });
    expect(where.appointments).toMatchObject({ clinicId: "clinic-1", patientId: { in: ["patient-1"] }, status: { in: ["SCHEDULED", "CONFIRMED"] } });
    expect(where.reports).toMatchObject({ clinicId: "clinic-1", patientId: { in: ["patient-1"] } });
    expect(s).toMatchObject({
      available: true,
      completed: false,
      progress: { personalSaved: true, medicalReviewed: false, completed: false },
      personal: { legalName: "ZZTEST Patient", dateOfBirth: "1990-05-17" },
      medical: { allergyStatus: "NONE_KNOWN", medications: [{ name: "Metformin", dose: null, frequency: null }] },
      appointments: [{ id: "appt-1", branchName: "ZZTEST Branch", doctorName: "Dr ZZTEST" }],
      recentSymptomReports: 2,
    });
  });

  it("before step 1 is saved, the clinic's record is only a starting point (nothing is assumed from the email)", async () => {
    const { tx } = fakeTx({ record: { name: "ZZTEST Clinic Name", dateOfBirth: new Date("1985-01-02T00:00:00Z"), gender: "FEMALE", phone: "+919800000002", addressLine: null, city: null, emergencyContactName: null, emergencyContactPhone: null } });
    const s = await getIntakeState(CTX, tx, NOW);
    expect(s).toMatchObject({ available: true, completed: false, progress: { personalSaved: false }, personal: { legalName: "ZZTEST Clinic Name", dateOfBirth: "1985-01-02", addressLine: "" }, medical: null });
    const none = await getIntakeState(CTX, fakeTx().tx, NOW);
    expect(none).toMatchObject({ personal: {} });
    expect(JSON.stringify(none)).not.toContain("zztest@example.com");
  });
});

describe("writes go only through the database functions", () => {
  it("step 1 passes the validated values; no patient, clinic or user id is sent", async () => {
    const { tx, calls } = fakeTx();
    await saveIntakePersonal(CTX, { legalName: "ZZTEST", dateOfBirth: "1990-05-17", gender: null, phone: "+919800000001", addressLine: "1 Rd", city: "Pune", state: null, postalCode: null, emergencyContactName: null, emergencyContactRelationship: null, emergencyContactPhone: null }, tx);
    expect(calls[0].sql).toMatch(/app\.save_patient_intake_personal\(/);
    expect(calls[0].values).not.toContain("patient-1");
    expect(calls[0].values).not.toContain("clinic-1");
    expect(calls[0].values).not.toContain("user-1");
  });

  it("step 2 sends the allergy status explicitly and the lists as JSON", async () => {
    const { tx, calls } = fakeTx();
    await saveIntakeMedical(CTX, { allergyStatus: "UNKNOWN", allergies: [], medications: [], conditions: [], pastSurgeries: null, familyHistory: null }, tx);
    expect(calls[0].sql).toMatch(/app\.save_patient_intake_medical\(/);
    expect(calls[0].values.slice(0, 3)).toEqual(["UNKNOWN", "[]", "[]"]);
  });

  it("step 3 appends with the request id and the chosen appointment (the database checks it is the patient's own)", async () => {
    const { tx, calls } = fakeTx();
    const r = await submitSymptomReport(CTX, { requestId: "req-1", appointmentId: "appt-1", reason: "Cough", symptoms: "Cough", onset: "TODAY", severity: null, notes: null }, tx);
    expect(calls[0].sql).toMatch(/app\.submit_patient_symptom_report\(/);
    expect(calls[0].values.slice(0, 2)).toEqual(["req-1", "appt-1"]);
    expect(r).toEqual({ created: true, appointmentLinked: true });
  });
});

describe("refusals", () => {
  it.each([
    ["patient intake: NOT_PERMITTED", AuthError, "FORBIDDEN"],
    ["patient intake: INVALID_INPUT", DataError, "INVALID_INPUT"],
    ["patient intake: PERSONAL_FIRST", DataError, "CONFLICT"],
    ["patient intake: APPOINTMENT_NOT_FOUND", DataError, "INVALID_INPUT"],
    ["patient intake: RATE_LIMITED", DataError, "RATE_LIMITED"],
    ['relation "patient_intake_profiles" does not exist', DataError, "FEATURE_UNAVAILABLE"],
    ["function app.complete_patient_intake() does not exist", DataError, "FEATURE_UNAVAILABLE"],
  ])("%s", async (message, type, code) => {
    const { tx } = fakeTx({ raise: new Error(message) });
    const err = await completeIntake(CTX, tx).catch((e) => e);
    expect(err).toBeInstanceOf(type);
    expect(err.code).toBe(code);
  });

  it("an appointment that isn't the patient's own is refused, never silently attached elsewhere", async () => {
    const { tx } = fakeTx({ raise: new Error("patient intake: APPOINTMENT_NOT_FOUND") });
    await expect(submitSymptomReport(CTX, { requestId: "r", appointmentId: "someone-elses", reason: "x", symptoms: "x", onset: "TODAY", severity: null, notes: null }, tx)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("unknown errors are rethrown untouched (reported upstream with codes only)", () => {
    const e = new Error("connection reset");
    expect(() => mapIntakeDbError(e)).toThrow(e);
    expect(isMissingIntakeSchema(new Error("connection reset"))).toBe(false);
  });
});

describe("staff review (patient-reported, read-only)", () => {
  const PATIENT = "5e1c0d2a-1111-4222-8333-944455556666";
  const staff = (permissions: string[]) => ({ ...CTX, permissions: new Set(permissions), branchId: null, roles: [], careScope: "clinic", doctorId: null }) as unknown as TenantContext;
  function staffTx(visible: boolean) {
    const audits: unknown[][] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => (/to_regclass/.test(strings.join("")) ? [{ ok: true }] : [{ visible }])),
      $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => void audits.push(values)),
      patientIntakeProfile: {
        findFirst: vi.fn(async () => ({
          legalName: "ZZTEST", dateOfBirth: new Date("1990-05-17T00:00:00Z"), gender: "FEMALE", phone: "+919800000001", addressLine: "1 Rd", city: "Pune", state: null, postalCode: null,
          emergencyContactName: null, emergencyContactRelationship: null, emergencyContactPhone: null, allergyStatus: "HAS_ALLERGIES", allergies: [{ substance: "Penicillin", reaction: "Rash" }],
          medications: [], conditions: [], pastSurgeries: null, familyHistory: null, personalSavedAt: new Date(), medicalReviewedAt: new Date(), completedAt: null, updatedAt: new Date(),
        })),
      },
      patientSymptomReport: { findMany: vi.fn(async () => [{ id: "r1", createdAt: new Date(), appointmentId: "a1", reason: "x", symptoms: "y", onset: "TODAY", severity: null, notes: null }]) },
      appointment: { findMany: vi.fn(async () => []) },
    };
    return { tx: tx as never, raw: tx, audits };
  }

  it("needs a medical-record permission: receptionists and nurses are refused before any query", async () => {
    const { tx, raw } = staffTx(true);
    for (const perms of [["patient.view", "patient.update_basic_info"], ["patient.view", "patient.basic_info.view", "lab_report.view", "vitals.create"]]) {
      await expect(getPatientReportedForStaff(staff(perms), PATIENT, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(raw.$queryRaw).not.toHaveBeenCalled();
  });

  it("a patient the database says the caller may not see is a 404, and the denial is audited (ids only)", async () => {
    const { tx, raw, audits } = staffTx(false);
    await expect(getPatientReportedForStaff(staff(["patient.medical_record.view"]), PATIENT, tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(raw.patientIntakeProfile.findFirst).not.toHaveBeenCalled();
    expect(audits).toEqual([[PATIENT]]);
  });

  it("returns the answers labelled by source, audits the view, and hides appointments the caller can't see", async () => {
    const { tx, audits } = staffTx(true);
    const view = await getPatientReportedForStaff(staff(["medical_record.view"]), PATIENT, tx);
    expect(view.profile).toMatchObject({ allergyStatus: "HAS_ALLERGIES", allergies: [{ substance: "Penicillin", reaction: "Rash" }] });
    expect(view.symptomReports).toEqual([expect.objectContaining({ id: "r1", appointmentLinked: true, appointmentAt: null })]);
    expect(audits).toEqual([[PATIENT]]);
    await expect(getPatientReportedForStaff(staff(["medical_record.view"]), "not-a-uuid", tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

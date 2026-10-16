import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";

// The onboarding Server Actions with the session and data layer stubbed (no
// database): only a verified, linked patient reaches the data layer; the
// patient comes from the SESSION, never the browser; failures return codes
// and safe messages only.

const auth = vi.hoisted(() => ({ error: null as unknown }));
const data = vi.hoisted(() => ({
  state: vi.fn(),
  personal: vi.fn(),
  medical: vi.fn(),
  skip: vi.fn(),
  symptoms: vi.fn(),
  complete: vi.fn(),
}));
const monitor = vi.hoisted(() => ({ report: vi.fn() }));
const CTX = { authUserId: "auth-1", userId: "user-1", email: "zztest@example.com", name: "ZZTEST", clinicId: "clinic-1", clinicName: "ZZTEST Clinic", patientIds: ["patient-1"] };

vi.mock("@/server/auth/session", () => ({
  requirePatient: async () => {
    if (auth.error) throw auth.error;
    return CTX;
  },
}));
vi.mock("@/server/data/patient-intake", () => ({
  getIntakeState: data.state,
  saveIntakePersonal: data.personal,
  saveIntakeMedical: data.medical,
  skipIntakeMedical: data.skip,
  submitSymptomReport: data.symptoms,
  completeIntake: data.complete,
}));
vi.mock("@/server/monitoring", () => ({ reportServerError: monitor.report }));

const actions = await import("./intake-actions");

const PERSONAL = { legalName: "ZZTEST Patient", dateOfBirth: "1990-05-17", gender: null, phone: "+919800000001", addressLine: "1 ZZTEST Rd", city: "Pune", state: "", postalCode: "", emergencyContactName: "", emergencyContactRelationship: "", emergencyContactPhone: "" };
const SYMPTOMS = { requestId: "5e1c0d2a-1111-4222-8333-944455556666", appointmentId: null, reason: "Cough", symptoms: "Dry cough", onset: "TODAY", severity: null, notes: "" };
const STATE = { available: true, completed: false, progress: { personalSaved: true, medicalReviewed: false, completed: false }, personal: {}, medical: null, appointments: [], recentSymptomReports: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  auth.error = null;
  data.state.mockResolvedValue(STATE);
});

describe("authentication", () => {
  it.each([
    ["UNAUTHENTICATED", "signed_out"],
    ["SESSION_EXPIRED", "signed_out"],
    ["NOT_PROVISIONED", "forbidden"],
    ["NO_MEMBERSHIP", "forbidden"],
  ] as const)("%s → %s, and nothing is saved", async (code, error) => {
    auth.error = new AuthError(code);
    for (const r of [
      await actions.saveIntakePersonalAction(PERSONAL),
      await actions.saveIntakeMedicalAction({}),
      await actions.skipIntakeMedicalAction(),
      await actions.submitIntakeSymptomsAction(SYMPTOMS),
      await actions.completeIntakeAction(),
    ]) {
      expect(r).toMatchObject({ ok: false, error });
    }
    for (const fn of Object.values(data)) expect(fn).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets no validation details", async () => {
    auth.error = new AuthError("UNAUTHENTICATED");
    const r = await actions.saveIntakePersonalAction({ legalName: "" });
    expect(r).toEqual({ ok: false, error: "signed_out", message: expect.any(String) });
  });
});

describe("only the signed-in patient's own profile", () => {
  it("saves with the session's context and returns the refreshed server state", async () => {
    const r = await actions.saveIntakePersonalAction(PERSONAL);
    expect(r).toEqual({ ok: true, state: STATE });
    expect(data.personal).toHaveBeenCalledWith(CTX, expect.objectContaining({ legalName: "ZZTEST Patient", phone: "+919800000001" }));
  });

  it("refuses a browser-chosen patient, clinic or user id before the database", async () => {
    for (const extra of [{ patientId: "someone-else" }, { clinicId: "other-clinic" }, { userId: "u" }]) {
      expect(await actions.saveIntakePersonalAction({ ...PERSONAL, ...extra })).toMatchObject({ ok: false, error: "invalid_input" });
      expect(await actions.saveIntakeMedicalAction({ ...extra })).toMatchObject({ ok: false, error: "invalid_input" });
      expect(await actions.submitIntakeSymptomsAction({ ...SYMPTOMS, ...extra })).toMatchObject({ ok: false, error: "invalid_input" });
    }
    expect(data.personal).not.toHaveBeenCalled();
    expect(data.medical).not.toHaveBeenCalled();
    expect(data.symptoms).not.toHaveBeenCalled();
  });

  it("a record the database refuses (not this patient's) is 'forbidden'", async () => {
    data.complete.mockRejectedValueOnce(new AuthError("FORBIDDEN"));
    expect(await actions.completeIntakeAction()).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("validation and failures", () => {
  it("invalid answers come back per field, without the values", async () => {
    const r = await actions.saveIntakePersonalAction({ ...PERSONAL, dateOfBirth: "2999-01-01", phone: "12345" });
    expect(r).toMatchObject({ ok: false, error: "invalid_input", fields: { dateOfBirth: expect.any(String), phone: expect.any(String) } });
    expect(JSON.stringify(r)).not.toMatch(/2999|12345/);
  });

  it("optional medical history can be skipped or saved empty", async () => {
    expect(await actions.skipIntakeMedicalAction()).toMatchObject({ ok: true });
    expect(await actions.saveIntakeMedicalAction({})).toMatchObject({ ok: true });
    expect(data.medical).toHaveBeenCalledWith(CTX, expect.objectContaining({ allergyStatus: "NOT_ANSWERED" }));
  });

  it("an appointment that isn't the patient's own is refused with a clear message", async () => {
    data.symptoms.mockRejectedValueOnce(new DataError("INVALID_INPUT", "That appointment isn't available any more."));
    expect(await actions.submitIntakeSymptomsAction({ ...SYMPTOMS, appointmentId: "5e1c0d2a-1111-4222-8333-944455556667" })).toMatchObject({ ok: false, error: "invalid_input", message: "That appointment isn't available any more." });
  });

  it("completing before step 1 is a conflict; rate limits pass through", async () => {
    data.complete.mockRejectedValueOnce(new DataError("CONFLICT", "Please save your personal information first."));
    expect(await actions.completeIntakeAction()).toMatchObject({ ok: false, error: "conflict" });
    data.symptoms.mockRejectedValueOnce(new DataError("RATE_LIMITED", "x"));
    expect(await actions.submitIntakeSymptomsAction(SYMPTOMS)).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("an unexpected database error is reported (codes only) and the patient sees a safe retry message", async () => {
    const err = Object.assign(new Error('Failing row contains (ZZTEST Patient, +919800000001)'), { name: "DatabaseError", code: "23514" });
    data.personal.mockRejectedValueOnce(err);
    const r = await actions.saveIntakePersonalAction(PERSONAL);
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    expect(JSON.stringify(r)).not.toMatch(/ZZTEST|9800000001|Failing row/);
    expect(monitor.report).toHaveBeenCalledWith("action patient_intake", err);
  });
});

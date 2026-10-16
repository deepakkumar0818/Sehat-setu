import { describe, expect, it } from "vitest";
import { fieldErrors, isRealDate, medicalSchema, personalSchema, resumeStep, shouldAutoOpen, symptomSchema, type IntakeState } from "./patient-intake";

// Synthetic values only ("ZZTEST"). Validation shared by the dialog and the Server Actions.

const TODAY = () => "2026-10-14";
const personal = (over: Record<string, unknown> = {}) => ({
  legalName: "ZZTEST Patient",
  dateOfBirth: "1990-05-17",
  gender: "",
  phone: "+91 98765 43210",
  addressLine: "12 ZZTEST Road",
  city: "Pune",
  state: "",
  postalCode: "411001",
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
  ...over,
});
const errorsOf = (r: { success: boolean; error?: import("zod").ZodError }) => (r.success ? {} : fieldErrors(r.error!));

describe("step 1: personal information", () => {
  it("accepts a complete answer and normalises the phone to E.164; optional fields become null", () => {
    const r = personalSchema(TODAY).parse(personal());
    expect(r).toMatchObject({ legalName: "ZZTEST Patient", phone: "+919876543210", gender: null, state: null, emergencyContactName: null, emergencyContactPhone: null });
  });

  it.each([
    ["an impossible date", "2026-02-30", /real date/],
    ["a future date", "2026-10-15", /future/],
    ["a date before 1900", "1899-12-31", /1900/],
    ["no date", "", /date of birth/],
    ["not a date", "17/05/1990", /real date/],
  ])("rejects %s of birth", (_l, dateOfBirth, message) => {
    expect(errorsOf(personalSchema(TODAY).safeParse(personal({ dateOfBirth }))).dateOfBirth).toMatch(message);
  });

  it("accepts today as a date of birth (a newborn)", () => {
    expect(personalSchema(TODAY).safeParse(personal({ dateOfBirth: "2026-10-14" })).success).toBe(true);
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2025-02-29")).toBe(false);
  });

  it("requires name, phone, address and city; messages never repeat the input", () => {
    const e = errorsOf(personalSchema(TODAY).safeParse(personal({ legalName: "  ", phone: "12345", addressLine: "", city: "" })));
    expect(Object.keys(e).sort()).toEqual(["addressLine", "city", "legalName", "phone"]);
    expect(JSON.stringify(e)).not.toContain("12345");
  });

  it("an emergency contact needs both a name and a phone number", () => {
    expect(errorsOf(personalSchema(TODAY).safeParse(personal({ emergencyContactName: "ZZTEST Spouse" }))).emergencyContactPhone).toBeTruthy();
    expect(errorsOf(personalSchema(TODAY).safeParse(personal({ emergencyContactPhone: "+919800000001" }))).emergencyContactName).toBeTruthy();
    expect(personalSchema(TODAY).parse(personal({ emergencyContactName: "ZZTEST Spouse", emergencyContactRelationship: "Spouse", emergencyContactPhone: "+91 98000 00001" })).emergencyContactPhone).toBe("+919800000001");
  });

  it("refuses ids from the browser (strict)", () => {
    for (const extra of [{ patientId: "x" }, { clinicId: "x" }, { userId: "x" }]) {
      expect(personalSchema(TODAY).safeParse(personal(extra)).success).toBe(false);
    }
  });
});

describe("step 2: medical history", () => {
  it("every field is optional: an empty answer is valid and stays NOT_ANSWERED", () => {
    expect(medicalSchema.parse({})).toEqual({ allergyStatus: "NOT_ANSWERED", allergies: [], medications: [], conditions: [], pastSurgeries: null, familyHistory: null });
  });

  it("'No known allergies' and 'Unknown' are distinct from each other and from unanswered", () => {
    const statuses = ["NONE_KNOWN", "UNKNOWN", "NOT_ANSWERED"].map((allergyStatus) => medicalSchema.parse({ allergyStatus }).allergyStatus);
    expect(new Set(statuses).size).toBe(3);
  });

  it("allergies are listed only with 'I have allergies', which needs at least one", () => {
    expect(errorsOf(medicalSchema.safeParse({ allergyStatus: "HAS_ALLERGIES", allergies: [] })).allergies).toBeTruthy();
    expect(errorsOf(medicalSchema.safeParse({ allergyStatus: "NONE_KNOWN", allergies: [{ substance: "Penicillin" }] })).allergyStatus).toBeTruthy();
    expect(medicalSchema.parse({ allergyStatus: "HAS_ALLERGIES", allergies: [{ substance: "Penicillin", reaction: "Rash" }, { substance: "Peanuts" }] }).allergies).toEqual([
      { substance: "Penicillin", reaction: "Rash" },
      { substance: "Peanuts", reaction: null },
    ]);
  });

  it("repeatable medicines and conditions; limits; strict entries", () => {
    expect(medicalSchema.parse({ medications: [{ name: "Metformin", dose: "500 mg", frequency: "" }], conditions: ["Type 2 diabetes"] })).toMatchObject({
      medications: [{ name: "Metformin", dose: "500 mg", frequency: null }],
      conditions: ["Type 2 diabetes"],
    });
    expect(medicalSchema.safeParse({ conditions: Array.from({ length: 31 }, () => "x") }).success).toBe(false);
    expect(medicalSchema.safeParse({ medications: [{ name: "x", prescribedBy: "y" }] }).success).toBe(false);
    expect(medicalSchema.safeParse({ diagnosis: "x" }).success).toBe(false);
  });
});

describe("step 3: symptoms (a pre-visit questionnaire, not a diagnosis)", () => {
  const symptoms = (over: Record<string, unknown> = {}) => ({ requestId: "5e1c0d2a-1111-4222-8333-944455556666", appointmentId: "", reason: "Cough", symptoms: "Dry cough for a week", onset: "DAYS_4_7", severity: "", notes: "", ...over });

  it("needs reason, symptoms and onset; severity and notes are optional", () => {
    expect(symptomSchema.parse(symptoms())).toMatchObject({ appointmentId: null, severity: null, notes: null });
    expect(Object.keys(errorsOf(symptomSchema.safeParse(symptoms({ reason: "", symptoms: "", onset: "" })))).sort()).toEqual(["onset", "reason", "symptoms"]);
  });

  it("needs a request id (duplicate protection) and only a well-formed appointment id", () => {
    expect(symptomSchema.safeParse(symptoms({ requestId: "1" })).success).toBe(false);
    expect(symptomSchema.safeParse(symptoms({ appointmentId: "not-a-uuid" })).success).toBe(false);
    expect(symptomSchema.safeParse(symptoms({ patientId: "x" })).success).toBe(false);
  });
});

describe("resume and auto-open (server state decides)", () => {
  const state = (progress: { personalSaved: boolean; medicalReviewed: boolean; completed: boolean }): IntakeState => ({
    available: true, completed: progress.completed, progress, personal: {}, medical: null, appointments: [], recentSymptomReports: 0,
  });

  it("resumes at the first unsaved step", () => {
    expect(resumeStep({ personalSaved: false, medicalReviewed: false, completed: false })).toBe(1);
    expect(resumeStep({ personalSaved: true, medicalReviewed: false, completed: false })).toBe(2);
    expect(resumeStep({ personalSaved: true, medicalReviewed: true, completed: false })).toBe(3);
  });

  it("opens for an incomplete profile, not for a complete one, not after 'Finish later' this session, not before the migration", () => {
    expect(shouldAutoOpen(state({ personalSaved: false, medicalReviewed: false, completed: false }), false)).toBe(true);
    expect(shouldAutoOpen(state({ personalSaved: true, medicalReviewed: true, completed: true }), false)).toBe(false);
    expect(shouldAutoOpen(state({ personalSaved: true, medicalReviewed: false, completed: false }), true)).toBe(false);
    expect(shouldAutoOpen({ available: false }, false)).toBe(false);
  });
});

describe("dates use the application's time zone (IST), not the browser's or UTC", () => {
  it("'today' rolls over at IST midnight", async () => {
    const { todayInAppZone, appointmentWhen } = await import("./patient-intake");
    expect(todayInAppZone(new Date("2026-10-14T18:29:00Z"))).toBe("2026-10-14"); // 23:59 IST
    expect(todayInAppZone(new Date("2026-10-14T18:31:00Z"))).toBe("2026-10-15"); // 00:01 IST, still the 14th in UTC
    expect(appointmentWhen("2026-10-15T04:30:00Z")).toMatch(/10:00\s?am/i);
  });

  it("a newborn's date of birth is accepted just after IST midnight", () => {
    const justAfterMidnightIst = () => "2026-10-15";
    expect(personalSchema(justAfterMidnightIst).safeParse({ ...personal(), dateOfBirth: "2026-10-15" }).success).toBe(true);
    expect(personalSchema(justAfterMidnightIst).safeParse({ ...personal(), dateOfBirth: "2026-10-16" }).success).toBe(false);
  });
});

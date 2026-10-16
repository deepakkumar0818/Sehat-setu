// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiRequestError } from "@/lib/api-client";
import type { PatientReportedView } from "@/lib/patient-intake";

// The staff patient page's "Patient-reported health information" section in a
// simulated browser. The query hook is replaced (no network); who may see it is
// enforced by the API and the database (patient-intake tests).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const q = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-patient-reported", () => ({ usePatientReported: () => q.value }));

const { PatientReportedCard } = await import("@/components/patients/patient-reported-card");

const VIEW: PatientReportedView = {
  profile: {
    legalName: "ZZTEST Patient", dateOfBirth: "1990-05-17", gender: "FEMALE", phone: "+919800000001", addressLine: "1 ZZTEST Rd", city: "Pune", state: null, postalCode: null,
    emergencyContactName: null, emergencyContactRelationship: null, emergencyContactPhone: null,
    allergyStatus: "HAS_ALLERGIES", allergies: [{ substance: "Penicillin", reaction: "Rash" }], medications: [{ name: "Metformin", dose: "500 mg", frequency: null }], conditions: ["Asthma"],
    pastSurgeries: null, familyHistory: null, personalSavedAt: "2026-10-14T05:00:00Z", medicalReviewedAt: "2026-10-14T05:05:00Z", completedAt: "2026-10-14T05:10:00Z", updatedAt: "2026-10-14T05:10:00Z",
  },
  symptomReports: [{ id: "r1", createdAt: "2026-10-14T05:10:00Z", appointmentAt: null, appointmentLinked: false, reason: "Cough", symptoms: "Dry cough", onset: "DAYS_4_7", severity: "MILD", notes: null }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () => act(() => root.render(<PatientReportedCard patientId="p1" />));

describe("Patient-reported health information (staff)", () => {
  it.each([403, 404, 503])("stays hidden when the API answers %i (no medical-record permission, other clinic, not migrated)", (status) => {
    q.value = { isLoading: false, isError: true, error: new ApiRequestError(status, "X", "x") };
    render();
    expect(host.textContent).toBe("");
  });

  it("is labelled as patient-reported and not clinician-confirmed; details on demand; nothing editable", () => {
    q.value = { isLoading: false, isError: false, data: VIEW };
    render();
    expect(host.textContent).toContain("Patient-reported health information");
    expect(host.textContent).toContain("not clinician-confirmed");
    expect(host.textContent).not.toContain("Penicillin");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show"))!.click());
    expect(host.textContent).toContain("Penicillin — Rash");
    expect(host.textContent).toContain("Metformin · 500 mg");
    expect(host.textContent).toContain("Verify before relying on it clinically");
    expect(host.textContent).toContain("Cough");
    expect(host.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });

  it("shows nothing when the patient hasn't answered anything", () => {
    q.value = { isLoading: false, isError: false, data: { profile: null, symptomReports: [] } };
    render();
    expect(host.textContent).toBe("");
  });
});

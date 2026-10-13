import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { analyzePrescriptionSafety, generateClinicInsights, generateConsultationNotes } from "@/services/ai";
import { getDb } from "@/store/data-store";

describe("AI mock service", () => {
  beforeEach(resetDb);

  it("flags duplicate medicines within the same prescription order", async () => {
    const patient = getDb().patients[0];
    const flags = await analyzePrescriptionSafety(patient.id, [
      { medicineName: "Ibuprofen", strength: "400 mg", dosage: "1 tablet", frequency: "Twice daily", duration: "5 days", route: "Oral" },
      { medicineName: "Ibuprofen", strength: "400 mg", dosage: "1 tablet", frequency: "Twice daily", duration: "5 days", route: "Oral" },
    ]);
    expect(flags.some((f) => f.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("flags a known interaction pair", async () => {
    const patient = getDb().patients[0];
    const flags = await analyzePrescriptionSafety(patient.id, [
      { medicineName: "Ibuprofen", strength: "400 mg", dosage: "1 tablet", frequency: "Twice daily", duration: "5 days", route: "Oral" },
      { medicineName: "Aspirin", strength: "75 mg", dosage: "1 tablet", frequency: "Once daily", duration: "5 days", route: "Oral" },
    ]);
    expect(flags.some((f) => f.toLowerCase().includes("interaction"))).toBe(true);
  });

  it("returns a clean review when there is nothing to flag", async () => {
    // Pick a patient with no existing prescription history, so this stays
    // robust to reseeding (their assigned records can shift deterministically
    // when unrelated seed generators change) rather than assuming patients[0]
    // happens to have no active Vitamin D3 prescription already.
    const db = getDb();
    const patient = db.patients.find((p) => !db.prescriptions.some((rx) => rx.patientId === p.id));
    expect(patient).toBeDefined();
    const flags = await analyzePrescriptionSafety(patient!.id, [
      { medicineName: "Vitamin D3", strength: "60000 IU", dosage: "1 sachet", frequency: "Once weekly", duration: "4 weeks", route: "Oral" },
    ]);
    expect(flags).toEqual([]);
  });

  it("extracts structured fields from a simulated consultation transcript", async () => {
    const draft = await generateConsultationNotes("Patient reports fever for three days, mild cough and fatigue. Temperature is 101°F. No vomiting reported.");
    expect(draft.symptoms).toEqual(expect.arrayContaining(["Fever", "Cough", "Fatigue"]));
    expect(draft.temperatureF).toBe(101);
    expect(draft.history.toLowerCase()).toContain("no vomiting");
  });

  it("generates a non-empty list of clinic insights derived from current data", async () => {
    const insights = await generateClinicInsights();
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.message.length).toBeGreaterThan(0);
    }
  });
});

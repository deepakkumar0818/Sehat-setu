import { describe, expect, it } from "vitest";
import { generateDatabase } from "@/data/seed";

// Guards the realism/scale requirements of the seed dataset — a demo that
// looks sparsely populated undermines the whole prototype.
describe("generateDatabase", () => {
  const db = generateDatabase();

  it.each([
    ["branches", 3],
    ["doctors", 8],
    ["staff", 15],
    ["patients", 100],
    ["appointments", 300],
    ["consultations", 100],
    ["prescriptions", 150],
    ["labReports", 100],
    ["medicines", 50],
    ["invoices", 200],
    ["payments", 200],
    ["expenses", 100],
    ["notifications", 100],
  ] as const)("seeds at least %i %s", (key, min) => {
    expect(db[key].length).toBeGreaterThanOrEqual(min);
  });

  it("gives every appointment a valid patient and doctor reference", () => {
    const patientIds = new Set(db.patients.map((p) => p.id));
    const doctorIds = new Set(db.doctors.map((d) => d.id));
    for (const appt of db.appointments) {
      expect(patientIds.has(appt.patientId)).toBe(true);
      expect(doctorIds.has(appt.doctorId)).toBe(true);
    }
  });

  it("links every consultation back to a real appointment", () => {
    const appointmentIds = new Set(db.appointments.map((a) => a.id));
    for (const c of db.consultations) {
      expect(appointmentIds.has(c.appointmentId)).toBe(true);
    }
  });

  it("is deterministic for the default seed", () => {
    const again = generateDatabase();
    expect(again.patients[0].name).toBe(db.patients[0].name);
    expect(again.doctors[0].name).toBe(db.doctors[0].name);
    expect(again.appointments.length).toBe(db.appointments.length);
  });
});

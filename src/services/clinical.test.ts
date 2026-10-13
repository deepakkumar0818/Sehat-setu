import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { completeConsultation, createPrescription } from "@/services/clinical";
import { startConsultation, createAppointment } from "@/services/appointments";
import { getDb } from "@/store/data-store";

describe("clinical service", () => {
  beforeEach(resetDb);

  it("creates a prescription and links it back to the source consultation", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;
    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-10",
      time: "10:00",
      type: "walk_in",
      reason: "Fever",
      fee: doctor.consultationFee,
    });
    const { consultation } = await startConsultation(appt.id);

    const prescription = await createPrescription({
      patientId: patient.id,
      doctorId: doctor.id,
      consultationId: consultation.id,
      items: [
        { medicineName: "Paracetamol", strength: "500 mg", dosage: "1 tablet", frequency: "Twice daily", duration: "5 days", route: "Oral" },
      ],
    });

    expect(prescription.id).toMatch(/^RX-\d{6}$/);
    expect(prescription.status).toBe("active");

    const updatedConsultation = getDb().consultations.find((c) => c.id === consultation.id)!;
    expect(updatedConsultation.prescriptionId).toBe(prescription.id);
  });

  it("flags duplicate medicines already active in another prescription", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;

    await createPrescription({
      patientId: patient.id,
      doctorId: doctor.id,
      items: [{ medicineName: "Amoxicillin", strength: "250 mg", dosage: "1 capsule", frequency: "Twice daily", duration: "5 days", route: "Oral" }],
    });

    const second = await createPrescription({
      patientId: patient.id,
      doctorId: doctor.id,
      items: [{ medicineName: "Amoxicillin", strength: "250 mg", dosage: "1 capsule", frequency: "Twice daily", duration: "5 days", route: "Oral" }],
    });

    expect(second.aiReviewFlags.length).toBeGreaterThan(0);
  });

  it("completing a consultation marks the linked appointment completed and updates patient lastVisit", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;
    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-10",
      time: "12:00",
      type: "walk_in",
      reason: "Checkup",
      fee: doctor.consultationFee,
    });
    const { consultation } = await startConsultation(appt.id);

    await completeConsultation(consultation.id, { clinicalNotes: "All good.", diagnosis: ["Viral fever"] });

    const updatedAppt = getDb().appointments.find((a) => a.id === appt.id)!;
    expect(updatedAppt.status).toBe("completed");

    const updatedPatient = getDb().patients.find((p) => p.id === patient.id)!;
    expect(updatedPatient.lastVisit).toBe(consultation.date);
  });
});

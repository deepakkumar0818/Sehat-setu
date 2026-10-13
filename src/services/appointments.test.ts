import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { cancelAppointment, checkInAppointment, createAppointment, markNoShow, startConsultation } from "@/services/appointments";
import { getDb } from "@/store/data-store";

describe("appointments service", () => {
  beforeEach(resetDb);

  it("creates a new appointment as upcoming with pending payment", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;

    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-10",
      time: "10:00",
      type: "in_person",
      reason: "Routine checkup",
      fee: doctor.consultationFee,
    });

    expect(appt.status).toBe("upcoming");
    expect(appt.paymentStatus).toBe("pending");
    expect(getDb().appointments.some((a) => a.id === appt.id)).toBe(true);
  });

  it("moves an appointment through check-in -> consultation -> (no direct completion) status transitions", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;
    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-10",
      time: "11:00",
      type: "walk_in",
      reason: "Fever",
      fee: doctor.consultationFee,
    });

    const checkedIn = await checkInAppointment(appt.id);
    expect(checkedIn.status).toBe("waiting");
    expect(checkedIn.checkedInAt).toBeDefined();

    const { appointment, consultation } = await startConsultation(appt.id);
    expect(appointment.status).toBe("in_consultation");
    expect(consultation.status).toBe("in_progress");
    expect(consultation.patientId).toBe(patient.id);
  });

  it("cancels an appointment", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;
    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-12",
      time: "09:00",
      type: "in_person",
      reason: "Consultation",
      fee: doctor.consultationFee,
    });

    const cancelled = await cancelAppointment(appt.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("marks an appointment as no-show", async () => {
    const doctor = getDb().doctors[0];
    const patient = getDb().patients.find((p) => p.branchId === doctor.branchId)!;
    const appt = await createAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: "2026-09-12",
      time: "09:30",
      type: "in_person",
      reason: "Consultation",
      fee: doctor.consultationFee,
    });

    const result = await markNoShow(appt.id);
    expect(result.status).toBe("no_show");
  });
});

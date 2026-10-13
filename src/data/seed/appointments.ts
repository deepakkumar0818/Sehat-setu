import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type { Appointment, AppointmentType, Doctor, Patient } from "@/types";
import { VISIT_REASONS } from "@/data/pools";

const SLOT_MINUTES: number[] = [];
for (let m = 9 * 60; m < 17 * 60; m += 30) {
  if (m >= 13 * 60 && m < 14 * 60) continue; // lunch break
  SLOT_MINUTES.push(m);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dateWithOffset(now: Date, offsetDays: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday
  return d;
}

/** Anchor "current time" within today for demo realism (11:45 AM). */
const NOW_MINUTES = 11 * 60 + 45;

function feeForType(base: number, type: AppointmentType): number {
  if (type === "follow_up") return Math.round((base * 0.5) / 50) * 50;
  if (type === "online") return Math.round((base * 0.9) / 50) * 50;
  return base;
}

export function generateAppointments(
  rng: Rng,
  patients: Patient[],
  doctors: Doctor[],
  now: Date,
  count = 320
): Appointment[] {
  const activeDoctors = doctors.filter((d) => d.status !== "inactive");
  const patientsByBranch = new Map<string, Patient[]>();
  for (const p of patients) {
    const list = patientsByBranch.get(p.branchId) ?? [];
    list.push(p);
    patientsByBranch.set(p.branchId, list);
  }

  const appointments: Appointment[] = [];

  for (let i = 0; i < count; i++) {
    const doctor = rng.pick(activeDoctors);
    const branchPatients = patientsByBranch.get(doctor.branchId) ?? patients;
    const patient = rng.pick(branchPatients);

    const bucket = i < count * 0.15 ? "today" : i < count * 0.65 ? "past" : "future";
    const offsetDays =
      bucket === "today" ? 0 : bucket === "past" ? rng.int(-60, -1) : rng.int(1, 14);
    const date = dateWithOffset(now, offsetDays);
    const slotMinutes = rng.pick(SLOT_MINUTES);

    const type: AppointmentType = rng.weighted([
      ["in_person", 55],
      ["follow_up", 20],
      ["online", 15],
      ["walk_in", 10],
    ]);

    const status = pickStatus(rng, offsetDays, slotMinutes);
    const paymentStatus = pickPaymentStatus(rng, status);
    const fee = feeForType(doctor.consultationFee, type);

    const dateIso = date.toISOString().slice(0, 10);
    const createdAt = dateWithOffset(now, offsetDays - rng.int(0, 5)).toISOString();

    const appt: Appointment = {
      id: padId("AP", 100000 + i + 1, 6),
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: doctor.branchId,
      date: dateIso,
      time: minutesToTime(slotMinutes),
      durationMinutes: type === "follow_up" ? 15 : 30,
      type,
      status,
      reason: rng.pick(VISIT_REASONS),
      paymentStatus,
      fee,
      createdAt,
    };

    if (status === "waiting" || status === "in_consultation" || status === "completed") {
      appt.checkedInAt = `${dateIso}T${minutesToTime(Math.max(slotMinutes - rng.int(2, 12), 0))}:00`;
    }
    if (status === "waiting" || status === "in_consultation") {
      appt.waitStartedAt = appt.checkedInAt;
    }

    appointments.push(appt);
  }

  return appointments.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function pickStatus(rng: Rng, offsetDays: number, slotMinutes: number): Appointment["status"] {
  if (offsetDays < 0) {
    return rng.weighted([
      ["completed", 82],
      ["cancelled", 10],
      ["no_show", 8],
    ]);
  }
  if (offsetDays > 0) {
    return rng.weighted([
      ["upcoming", 90],
      ["cancelled", 10],
    ]);
  }
  // Today — status depends on the slot relative to the demo's "current time".
  const delta = slotMinutes - NOW_MINUTES;
  if (delta < -60) {
    return rng.weighted([
      ["completed", 75],
      ["no_show", 10],
      ["cancelled", 5],
      ["waiting", 10],
    ]);
  }
  if (delta <= 60) {
    return rng.weighted([
      ["waiting", 40],
      ["in_consultation", 30],
      ["completed", 20],
      ["no_show", 10],
    ]);
  }
  return rng.weighted([
    ["upcoming", 90],
    ["cancelled", 10],
  ]);
}

function pickPaymentStatus(rng: Rng, status: Appointment["status"]): Appointment["paymentStatus"] {
  if (status === "completed") {
    return rng.weighted([
      ["paid", 80],
      ["partial", 15],
      ["pending", 5],
    ]);
  }
  if (status === "waiting" || status === "in_consultation") {
    return rng.weighted([
      ["pending", 60],
      ["paid", 40],
    ]);
  }
  if (status === "upcoming") {
    return rng.weighted([
      ["pending", 70],
      ["paid", 30],
    ]);
  }
  return "pending";
}

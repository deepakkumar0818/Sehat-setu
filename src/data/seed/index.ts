import { Rng } from "@/lib/rng";
import { DEMO_NOW } from "@/lib/demo-clock";
import type { SehatSetuDatabase } from "@/types";
import { generateBranches } from "@/data/seed/branches";
import { generateDoctors, generateStaff } from "@/data/seed/people";
import { generatePatients } from "@/data/seed/patients";
import { generateAppointments } from "@/data/seed/appointments";
import { generateClinicalRecords } from "@/data/seed/clinical";
import { generateMedicines } from "@/data/seed/pharmacy";
import { generateBilling, generateExpenses } from "@/data/seed/billing";
import { generateAuditLog, generateNotifications } from "@/data/seed/comms";
import {
  generateClinic,
  generateClinicSpecialties,
  generateDepartments,
  generateRoles,
  generateSpecialties,
  specialtyIdForSpecialization,
} from "@/data/seed/tenants";

export const CURRENT_SEED_VERSION = 4;

export function generateDatabase(seed: number = 20260905): SehatSetuDatabase {
  const rng = new Rng(seed);
  const now = DEMO_NOW;

  const clinic = generateClinic();
  const specialties = generateSpecialties();
  const clinicSpecialties = generateClinicSpecialties(clinic.id, specialties);
  const roles = generateRoles(clinic.id);

  const branches = generateBranches(clinic.id);
  const doctors = generateDoctors(rng, branches, now, clinic.id, 22);
  for (const doctor of doctors) {
    doctor.specialtyId = specialtyIdForSpecialization(specialties, doctor.specialization);
  }
  const departments = generateDepartments(clinic.id, doctors, specialties);
  for (const doctor of doctors) {
    const dept = departments.find((d) => d.branchId === doctor.branchId && d.specialtyId === doctor.specialtyId);
    doctor.departmentId = dept?.id;
  }
  const staff = generateStaff(rng, branches, now, clinic.id);
  for (const member of staff) {
    const dept = departments.find((d) => d.branchId === member.branchId);
    if (member.role === "nurse" && dept) member.departmentId = dept.id;
  }
  const patients = generatePatients(rng, branches, now, 150);
  const appointments = generateAppointments(rng, patients, doctors, now, 900);

  const { consultations, prescriptions, labReports, documents } = generateClinicalRecords(
    rng,
    appointments,
    patients,
    doctors,
    now
  );

  const { medicines, stockMovements } = generateMedicines(rng, now);
  const { invoices, payments } = generateBilling(rng, appointments, consultations, prescriptions, now);
  const expenses = generateExpenses(rng, branches.map((b) => b.id), now);

  const commsInput = { rng, now, doctors, staff, patients, appointments, prescriptions, labReports, invoices, payments, medicines };
  const notifications = generateNotifications(commsInput);
  const auditLog = generateAuditLog(commsInput);

  // Derive lastVisit / nextAppointmentId on each patient from generated appointments.
  const apptsByPatient = new Map<string, typeof appointments>();
  for (const appt of appointments) {
    const list = apptsByPatient.get(appt.patientId) ?? [];
    list.push(appt);
    apptsByPatient.set(appt.patientId, list);
  }
  for (const patient of patients) {
    const own = (apptsByPatient.get(patient.id) ?? []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const past = own.filter((a) => a.status === "completed");
    if (past.length) patient.lastVisit = past[past.length - 1].date;
    const upcoming = own.find((a) => a.status === "upcoming");
    if (upcoming) patient.nextAppointmentId = upcoming.id;
  }

  return {
    seedVersion: CURRENT_SEED_VERSION,
    generatedAt: new Date().toISOString(),
    clinics: [clinic],
    specialties,
    clinicSpecialties,
    departments,
    roles,
    branches,
    doctors,
    staff,
    patients,
    appointments,
    consultations,
    prescriptions,
    labReports,
    documents,
    medicines,
    stockMovements,
    invoices,
    payments,
    expenses,
    notifications,
    auditLog,
  };
}

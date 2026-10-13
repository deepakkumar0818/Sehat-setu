import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { getCurrentUser } from "@/store/auth-store";
import { assertBranchAccess, visibleBranchIds } from "@/lib/rbac";
import { AVATAR_COLORS } from "@/data/pools";
import type { Patient, PatientStatus, TimelineEvent } from "@/types";

export interface ListPatientsParams {
  search?: string;
  status?: PatientStatus | "all";
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "lastVisit" | "registeredDate";
  sortDir?: "asc" | "desc";
}

export async function listPatients(params: ListPatientsParams = {}): Promise<PagedResult<Patient>> {
  await delay();
  const { search = "", status = "all", branchId = "all", page = 1, pageSize = 10, sortBy = "name", sortDir = "asc" } = params;
  const db = getDb();
  const scopedBranchIds = visibleBranchIds(getCurrentUser(), db);
  let items = db.patients.filter((p) => {
    if (status !== "all" && p.status !== status) return false;
    if (branchId !== "all" && p.branchId !== branchId) return false;
    if (scopedBranchIds !== "all" && !scopedBranchIds.includes(p.branchId)) return false;
    return matchesSearch([p.name, p.id, p.phone, p.email], search);
  });

  items = [...items].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "name") cmp = a.name.localeCompare(b.name);
    else if (sortBy === "lastVisit") cmp = (a.lastVisit ?? "").localeCompare(b.lastVisit ?? "");
    else cmp = a.registeredDate.localeCompare(b.registeredDate);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return paginate(items, page, pageSize);
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  await delay(250);
  const db = getDb();
  const patient = db.patients.find((p) => p.id === id);
  if (!patient) return undefined;

  // Tenant isolation for staff/doctor sessions only — a patient viewing the
  // portal always fetches their own record by their own patientId, so no
  // clinic check applies there (patients are platform-level, not clinic-scoped).
  const user = getCurrentUser();
  if (user && user.role !== "patient") {
    const branch = db.branches.find((b) => b.id === patient.branchId);
    if (branch) assertBranchAccess(user, branch);
  }
  return patient;
}

export interface CreatePatientInput {
  name: string;
  age: number;
  gender: Patient["gender"];
  phone: string;
  email: string;
  bloodGroup: string;
  address: string;
  city: string;
  branchId: string;
  allergies?: string[];
  chronicConditions?: string[];
}

export async function createPatient(input: CreatePatientInput): Promise<Patient> {
  await delay(400);
  const db = getDb();
  const nextNumber = db.patients.length + 10001;
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - input.age);
  const patient: Patient = {
    id: padId("PT", nextNumber),
    name: input.name,
    age: input.age,
    dob: dob.toISOString().slice(0, 10),
    gender: input.gender,
    phone: input.phone,
    email: input.email,
    bloodGroup: input.bloodGroup,
    address: input.address,
    city: input.city,
    branchId: input.branchId,
    status: "active",
    allergies: input.allergies ?? [],
    chronicConditions: input.chronicConditions ?? [],
    registeredDate: new Date().toISOString().slice(0, 10),
    avatarColor: AVATAR_COLORS[db.patients.length % AVATAR_COLORS.length],
    emergencyContact: { name: "", phone: "", relation: "Other" },
  };
  mutateDb((d) => ({ ...d, patients: [patient, ...d.patients] }));
  return patient;
}

export interface RegisterPatientInput {
  name: string;
  phone: string;
  email: string;
  dob: string; // yyyy-MM-dd
  gender: Patient["gender"];
  password: string;
  branchId?: string;
}

function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

/** Public self-registration (see /register) — distinct from admin-created patients in that the patient sets their own password. */
export async function registerPatient(input: RegisterPatientInput): Promise<Patient> {
  await delay(500);
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (db.patients.some((p) => p.email.toLowerCase() === normalizedEmail)) {
    throw new Error("An account with this email already exists. Try signing in instead.");
  }

  const nextNumber = db.patients.length + 10001;
  const patient: Patient = {
    id: padId("PT", nextNumber),
    name: input.name,
    age: ageFromDob(input.dob),
    dob: input.dob,
    gender: input.gender,
    phone: input.phone,
    email: input.email,
    bloodGroup: "Unknown",
    address: "",
    city: db.branches.find((b) => b.id === input.branchId)?.city ?? db.branches[0]?.city ?? "",
    branchId: input.branchId ?? db.branches[0]?.id ?? "",
    status: "active",
    allergies: [],
    chronicConditions: [],
    registeredDate: new Date().toISOString().slice(0, 10),
    avatarColor: AVATAR_COLORS[db.patients.length % AVATAR_COLORS.length],
    emergencyContact: { name: "", phone: "", relation: "Other" },
    password: input.password,
  };
  mutateDb((d) => ({ ...d, patients: [patient, ...d.patients] }));
  return patient;
}

export async function updatePatient(id: string, patch: Partial<Patient>): Promise<Patient> {
  await delay(350);
  let updated: Patient | undefined;
  mutateDb((d) => ({
    ...d,
    patients: d.patients.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...patch };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Patient not found");
  return updated;
}

export async function setPatientStatus(id: string, status: PatientStatus): Promise<void> {
  await updatePatient(id, { status });
}

export async function getPatientTimeline(patientId: string): Promise<TimelineEvent[]> {
  await delay(300);
  const db = getDb();
  const events: TimelineEvent[] = [];

  for (const c of db.consultations.filter((x) => x.patientId === patientId)) {
    const doctor = db.doctors.find((d) => d.id === c.doctorId);
    events.push({
      id: `evt-${c.id}`,
      patientId,
      date: c.date,
      type: "consultation",
      title: c.status === "completed" ? "Consultation completed" : "Consultation in progress",
      subtitle: doctor ? `${doctor.name} · ${c.chiefComplaint}` : c.chiefComplaint,
      refId: c.id,
      href: `/consultations/${c.id}`,
    });
  }
  for (const r of db.labReports.filter((x) => x.patientId === patientId)) {
    events.push({
      id: `evt-${r.id}`,
      patientId,
      date: r.date,
      type: "report",
      title: `${r.title} ${r.status === "available" ? "uploaded" : "ordered"}`,
      subtitle: r.status === "available" ? "Report available" : "Awaiting results",
      refId: r.id,
      href: `/reports/${r.id}`,
    });
  }
  for (const rx of db.prescriptions.filter((x) => x.patientId === patientId)) {
    const doctor = db.doctors.find((d) => d.id === rx.doctorId);
    events.push({
      id: `evt-${rx.id}`,
      patientId,
      date: rx.date,
      type: "prescription",
      title: "Prescription created",
      subtitle: doctor ? `${doctor.name} · ${rx.items.length} item(s)` : `${rx.items.length} item(s)`,
      refId: rx.id,
      href: `/prescriptions/${rx.id}`,
    });
  }
  for (const inv of db.invoices.filter((x) => x.patientId === patientId)) {
    events.push({
      id: `evt-${inv.id}`,
      patientId,
      date: inv.date,
      type: "invoice",
      title: `Invoice ${inv.status === "paid" ? "paid" : inv.status}`,
      subtitle: `₹${inv.total.toLocaleString("en-IN")}`,
      refId: inv.id,
      href: `/billing/${inv.id}`,
    });
  }
  for (const a of db.appointments.filter((x) => x.patientId === patientId && (x.status === "cancelled" || x.status === "no_show"))) {
    const doctor = db.doctors.find((d) => d.id === a.doctorId);
    events.push({
      id: `evt-${a.id}`,
      patientId,
      date: a.date,
      type: "appointment",
      title: a.status === "cancelled" ? "Appointment cancelled" : "Missed appointment",
      subtitle: doctor?.name,
      refId: a.id,
      href: `/appointments`,
    });
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}

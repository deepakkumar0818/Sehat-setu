import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import { getDb, mutateDb } from "@/store/data-store";
import { getCurrentUser } from "@/store/auth-store";
import { assertBranchAccess, visibleBranchIds } from "@/lib/rbac";
import type { Appointment, AppointmentStatus, AppointmentType, Consultation } from "@/types";

export interface ListAppointmentsParams {
  search?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  doctorId?: string | "all";
  branchId?: string | "all";
  status?: AppointmentStatus | "all";
  type?: AppointmentType | "all";
  patientId?: string;
  page?: number;
  pageSize?: number;
}

export interface AppointmentWithNames extends Appointment {
  patientName: string;
  doctorName: string;
  /** Live data only: true when the viewer may not see billing, so paymentStatus is unknown. */
  billingHidden?: boolean;
  /** Live data only: may the viewer create this appointment's invoice (UI hint; the server re-checks). */
  canCreateInvoice?: boolean;
  /** Live data only: is the viewer this appointment's doctor, able to start/continue its consultation (UI hint). */
  canConsult?: boolean;
}

function enrich(a: Appointment): AppointmentWithNames {
  const db = getDb();
  return {
    ...a,
    patientName: db.patients.find((p) => p.id === a.patientId)?.name ?? "Unknown patient",
    doctorName: db.doctors.find((d) => d.id === a.doctorId)?.name ?? "Unknown doctor",
  };
}

export async function listAppointments(params: ListAppointmentsParams = {}): Promise<PagedResult<AppointmentWithNames>> {
  await delay();
  const { search = "", date, dateFrom, dateTo, doctorId = "all", branchId = "all", status = "all", type = "all", patientId, page = 1, pageSize = 10 } = params;
  const db = getDb();
  const scopedBranchIds = visibleBranchIds(getCurrentUser(), db);

  const items = db.appointments.filter((a) => {
    if (date && a.date !== date) return false;
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo && a.date > dateTo) return false;
    if (doctorId !== "all" && a.doctorId !== doctorId) return false;
    if (branchId !== "all" && a.branchId !== branchId) return false;
    if (scopedBranchIds !== "all" && !scopedBranchIds.includes(a.branchId)) return false;
    if (status !== "all" && a.status !== status) return false;
    if (type !== "all" && a.type !== type) return false;
    if (patientId && a.patientId !== patientId) return false;
    return true;
  });

  const enriched = items.map(enrich);
  const filtered = search
    ? enriched.filter((a) => matchesSearch([a.patientName, a.doctorName, a.id, a.reason], search))
    : enriched;

  filtered.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return paginate(filtered, page, pageSize);
}

export async function getAppointment(id: string): Promise<AppointmentWithNames | undefined> {
  await delay(250);
  const db = getDb();
  const found = db.appointments.find((a) => a.id === id);
  if (!found) return undefined;

  const user = getCurrentUser();
  if (user && user.role !== "patient") {
    const branch = db.branches.find((b) => b.id === found.branchId);
    if (branch) assertBranchAccess(user, branch);
  }
  return enrich(found);
}

export async function getTodaysAppointments(branchId?: string): Promise<AppointmentWithNames[]> {
  await delay(300);
  const today = todayDateStr();
  const items = getDb().appointments.filter((a) => a.date === today && (!branchId || a.branchId === branchId));
  return items.map(enrich).sort((a, b) => a.time.localeCompare(b.time));
}

export async function getWaitingRoom(branchId?: string): Promise<AppointmentWithNames[]> {
  await delay(300);
  const today = todayDateStr();
  const items = getDb().appointments.filter(
    (a) => a.date === today && (a.status === "waiting" || a.status === "in_consultation") && (!branchId || a.branchId === branchId)
  );
  return items.map(enrich).sort((a, b) => (a.waitStartedAt ?? "").localeCompare(b.waitStartedAt ?? ""));
}

export interface CreateAppointmentInput {
  patientId: string;
  doctorId: string;
  branchId: string;
  date: string;
  time: string;
  type: AppointmentType;
  reason: string;
  notes?: string;
  fee: number;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  await delay(400);
  const db = getDb();
  const appointment: Appointment = {
    id: padId("AP", 100000 + db.appointments.length + 1, 6),
    patientId: input.patientId,
    doctorId: input.doctorId,
    branchId: input.branchId,
    date: input.date,
    time: input.time,
    durationMinutes: input.type === "follow_up" ? 15 : 30,
    type: input.type,
    status: "upcoming",
    reason: input.reason,
    notes: input.notes,
    paymentStatus: "pending",
    fee: input.fee,
    createdAt: new Date().toISOString(),
  };
  mutateDb((d) => ({ ...d, appointments: [...d.appointments, appointment] }));
  return appointment;
}

async function patchAppointment(id: string, patch: Partial<Appointment>): Promise<Appointment> {
  let updated: Appointment | undefined;
  mutateDb((d) => ({
    ...d,
    appointments: d.appointments.map((a) => {
      if (a.id !== id) return a;
      updated = { ...a, ...patch };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Appointment not found");
  return updated;
}

export async function checkInAppointment(id: string): Promise<Appointment> {
  await delay(300);
  const now = DEMO_NOW.toISOString();
  return patchAppointment(id, { status: "waiting", checkedInAt: now, waitStartedAt: now });
}

export async function cancelAppointment(id: string): Promise<Appointment> {
  await delay(300);
  return patchAppointment(id, { status: "cancelled" });
}

export async function markNoShow(id: string): Promise<Appointment> {
  await delay(300);
  return patchAppointment(id, { status: "no_show" });
}

export async function rescheduleAppointment(id: string, date: string, time: string): Promise<Appointment> {
  await delay(350);
  return patchAppointment(id, { date, time, status: "upcoming" });
}

export async function startConsultation(id: string): Promise<{ appointment: Appointment; consultation: Consultation }> {
  await delay(400);
  const db = getDb();
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) throw new Error("Appointment not found");

  const consultation: Consultation = {
    id: padId("CN", 100000 + db.consultations.length + 1, 6),
    appointmentId: appt.id,
    patientId: appt.patientId,
    doctorId: appt.doctorId,
    branchId: appt.branchId,
    date: appt.date,
    chiefComplaint: appt.reason,
    symptoms: [],
    allergiesNoted: [],
    vitals: {},
    diagnosis: [],
    clinicalNotes: "",
    labTestsOrdered: [],
    status: "in_progress",
  };

  const waitStartedAt = appt.waitStartedAt ?? DEMO_NOW.toISOString();

  mutateDb((d) => ({
    ...d,
    consultations: [...d.consultations, consultation],
    appointments: d.appointments.map((a) =>
      a.id === id ? { ...a, status: "in_consultation" as const, consultationId: consultation.id, waitStartedAt } : a
    ),
  }));

  const updatedAppt = { ...appt, status: "in_consultation" as const, consultationId: consultation.id, waitStartedAt };
  return { appointment: updatedAppt, consultation };
}

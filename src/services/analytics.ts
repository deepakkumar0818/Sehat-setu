import { delay } from "@/lib/async";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import { getDb } from "@/store/data-store";
import { getMedicineStatus } from "@/data/seed/pharmacy";
import type { AppointmentStatus } from "@/types";

export interface DashboardKpis {
  totalPatients: number;
  todaysAppointments: number;
  todaysRevenue: number;
  pendingReports: number;
  waitingPatients: number;
  onlineConsultationsToday: number;
  outstandingPayments: number;
  lowStockMedicines: number;
}

export async function getDashboardKpis(branchId?: string): Promise<DashboardKpis> {
  await delay(350);
  const db = getDb();
  const today = todayDateStr();
  const inBranch = (id: string) => !branchId || id === branchId;

  const patients = db.patients.filter((p) => inBranch(p.branchId));
  const patientIds = new Set(patients.map((p) => p.id));
  const invoices = db.invoices.filter((i) => inBranch(i.branchId));
  const invoiceIds = new Set(invoices.map((i) => i.id));

  const todaysAppts = db.appointments.filter((a) => a.date === today && inBranch(a.branchId));

  return {
    totalPatients: patients.filter((p) => p.status !== "archived").length,
    todaysAppointments: todaysAppts.length,
    todaysRevenue: db.payments.filter((p) => p.date === today && invoiceIds.has(p.invoiceId)).reduce((s, p) => s + p.amount, 0),
    pendingReports: db.labReports.filter((r) => r.status === "pending" && patientIds.has(r.patientId)).length,
    waitingPatients: todaysAppts.filter((a) => a.status === "waiting").length,
    onlineConsultationsToday: todaysAppts.filter((a) => a.type === "online").length,
    outstandingPayments: invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.balance, 0),
    lowStockMedicines: db.medicines.filter((m) => ["low_stock", "out_of_stock"].includes(getMedicineStatus(m, DEMO_NOW))).length,
  };
}

export interface RevenueTrendPoint {
  date: string;
  revenue: number;
}

export async function getRevenueTrend(days = 30): Promise<RevenueTrendPoint[]> {
  await delay(400);
  const db = getDb();
  const points: RevenueTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(DEMO_NOW);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    points.push({ date: iso, revenue: db.payments.filter((p) => p.date === iso).reduce((s, p) => s + p.amount, 0) });
  }
  return points;
}

export interface PatientGrowthPoint {
  date: string;
  new: number;
  returning: number;
}

/** Weekly buckets — daily new-patient counts are too sparse for a single clinic to read well. */
export async function getPatientGrowth(weeks = 10): Promise<PatientGrowthPoint[]> {
  await delay(400);
  const db = getDb();
  const points: PatientGrowthPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekEnd = new Date(DEMO_NOW);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    const startIso = weekStart.toISOString().slice(0, 10);
    const endIso = weekEnd.toISOString().slice(0, 10);

    const newPatients = db.patients.filter((p) => p.registeredDate >= startIso && p.registeredDate <= endIso).length;
    const completedVisits = db.appointments.filter((a) => a.date >= startIso && a.date <= endIso && a.status === "completed").length;
    points.push({ date: startIso, new: newPatients, returning: Math.max(completedVisits - newPatients, 0) });
  }
  return points;
}

export interface AppointmentStatusCount {
  status: AppointmentStatus;
  count: number;
}

export async function getAppointmentStatusBreakdown(days = 30): Promise<AppointmentStatusCount[]> {
  await delay(300);
  const db = getDb();
  const cutoff = new Date(DEMO_NOW);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const relevant = db.appointments.filter((a) => a.date >= cutoffIso);

  const statuses: AppointmentStatus[] = ["completed", "waiting", "upcoming", "cancelled", "no_show"];
  return statuses.map((status) => ({ status, count: relevant.filter((a) => a.status === status).length }));
}

export interface DoctorPerformanceRow {
  doctorId: string;
  name: string;
  specialization: string;
  appointments: number;
  completed: number;
  revenue: number;
  followUps: number;
}

export async function getDoctorPerformance(): Promise<DoctorPerformanceRow[]> {
  await delay(400);
  const db = getDb();
  return db.doctors.map((doctor) => {
    const appts = db.appointments.filter((a) => a.doctorId === doctor.id);
    const completed = appts.filter((a) => a.status === "completed");
    const revenue = db.invoices
      .filter((i) => appts.some((a) => a.id === i.appointmentId))
      .reduce((s, i) => s + i.paid, 0);
    return {
      doctorId: doctor.id,
      name: doctor.name,
      specialization: doctor.specialization,
      appointments: appts.length,
      completed: completed.length,
      revenue,
      followUps: appts.filter((a) => a.type === "follow_up").length,
    };
  }).sort((a, b) => b.appointments - a.appointments);
}

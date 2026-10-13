import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type {
  Appointment,
  AppNotification,
  AuditLogEntry,
  Doctor,
  Invoice,
  LabReport,
  Medicine,
  Patient,
  Payment,
  Prescription,
  StaffMember,
} from "@/types";
import { getMedicineStatus } from "@/data/seed/pharmacy";

interface CommsInput {
  rng: Rng;
  now: Date;
  doctors: Doctor[];
  staff: StaffMember[];
  patients: Patient[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  labReports: LabReport[];
  invoices: Invoice[];
  payments: Payment[];
  medicines: Medicine[];
}

export function generateNotifications(input: CommsInput): AppNotification[] {
  const { rng, now, doctors, patients, appointments, prescriptions, labReports, payments, medicines } = input;
  const notifications: AppNotification[] = [];
  let counter = 1;
  const patientsById = new Map(patients.map((p) => [p.id, p]));
  const doctorsById = new Map(doctors.map((d) => [d.id, d]));
  const nowIso = now.toISOString();

  const push = (n: Omit<AppNotification, "id" | "date" | "read"> & { date?: string }) => {
    notifications.push({
      id: padId("NT", 100000 + counter++, 6),
      date: n.date ?? nowIso,
      read: rng.bool(0.55),
      ...n,
    });
  };

  const upcomingSoon = appointments
    .filter((a) => a.status === "upcoming" && new Date(a.date).getTime() - now.getTime() <= 3 * 86_400_000)
    .slice(0, 40);
  for (const appt of upcomingSoon) {
    const doctor = doctorsById.get(appt.doctorId);
    push({
      patientId: appt.patientId,
      type: "appointment_reminder",
      title: "Upcoming appointment",
      message: `You have an appointment with ${doctor?.name ?? "your doctor"} on ${appt.date} at ${appt.time}.`,
      link: "/portal/appointments",
    });
  }

  const recentReports = [...labReports]
    .filter((r) => r.status === "available")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 25);
  for (const report of recentReports) {
    push({
      patientId: report.patientId,
      type: "report_available",
      title: "Lab report available",
      message: `Your ${report.type} report dated ${report.date} is now available.`,
      date: report.date,
      link: "/portal/reports",
    });
  }

  const recentPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
  for (const payment of recentPayments) {
    const patient = patientsById.get(payment.patientId);
    push({
      audienceRole: "clinic_admin",
      patientId: payment.patientId,
      type: "payment_received",
      title: "Payment received",
      message: `Payment of ₹${payment.amount.toLocaleString("en-IN")} received from ${patient?.name ?? "patient"}.`,
      date: payment.date,
      link: "/billing",
    });
  }

  const recentPrescriptions = [...prescriptions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  for (const rx of recentPrescriptions) {
    const doctor = doctorsById.get(rx.doctorId);
    push({
      patientId: rx.patientId,
      type: "prescription_created",
      title: "New prescription",
      message: `${doctor?.name ?? "Your doctor"} created a new prescription for you.`,
      date: rx.date,
      link: "/portal/prescriptions",
    });
  }

  for (const medicine of medicines) {
    const status = getMedicineStatus(medicine, now);
    if (status === "low_stock" || status === "out_of_stock") {
      push({
        audienceRole: "pharmacist",
        type: "low_stock",
        title: status === "out_of_stock" ? "Medicine out of stock" : "Low stock warning",
        message: `${medicine.name} (${medicine.batchNumber}) is ${status === "out_of_stock" ? "out of stock" : `running low — ${medicine.stock} ${medicine.unit} remaining`}.`,
        link: "/inventory",
      });
    } else if (status === "expiring_soon" || status === "expired") {
      push({
        audienceRole: "pharmacist",
        type: "expiry_warning",
        title: status === "expired" ? "Medicine expired" : "Medicine expiring soon",
        message: `${medicine.name} batch ${medicine.batchNumber} ${status === "expired" ? "has expired" : `expires on ${medicine.expiryDate}`}.`,
        link: "/inventory",
      });
    }
  }

  const insights = [
    "Patient visits increased 14% this week compared to last week.",
    "Evening appointment slots (4–6 PM) are the busiest this month.",
    "No-show rate increased 8% over the last two weeks.",
    "6 medicines are approaching their expiry date.",
    "Follow-up appointment bookings are down 5% this month.",
  ];
  for (const message of insights) {
    push({ audienceRole: "clinic_admin", type: "ai_insight", title: "AI insight", message, link: "/analytics" });
  }

  push({
    type: "system",
    title: "Welcome to Sehat Setu",
    message: "Your clinic workspace is set up. Explore the dashboard to get started.",
  });
  push({
    type: "system",
    title: "New AI features available",
    message: "AI-assisted consultation notes and prescription safety review are now available.",
  });

  return notifications.sort((a, b) => b.date.localeCompare(a.date));
}

const ACTION_TEMPLATES: { action: string; entityType: string; roles: AuditLogEntry["actorRole"][] }[] = [
  { action: "Created appointment", entityType: "appointment", roles: ["receptionist", "clinic_admin"] },
  { action: "Checked in patient", entityType: "appointment", roles: ["receptionist", "nurse"] },
  { action: "Cancelled appointment", entityType: "appointment", roles: ["receptionist", "clinic_admin"] },
  { action: "Updated patient record", entityType: "patient", roles: ["doctor", "nurse", "clinic_admin"] },
  { action: "Created prescription", entityType: "prescription", roles: ["doctor"] },
  { action: "Uploaded lab report", entityType: "lab_report", roles: ["lab_staff"] },
  { action: "Updated medicine inventory", entityType: "medicine", roles: ["pharmacist"] },
  { action: "Created invoice", entityType: "invoice", roles: ["receptionist", "clinic_admin"] },
  { action: "Collected payment", entityType: "payment", roles: ["receptionist"] },
  { action: "Updated staff profile", entityType: "staff", roles: ["clinic_admin"] },
];

export function generateAuditLog(input: CommsInput, count = 130): AuditLogEntry[] {
  const { rng, now, doctors, staff } = input;
  const actors = [...doctors.map((d) => ({ name: d.name, role: "doctor" as const, branchId: d.branchId })), ...staff.map((s) => ({ name: s.name, role: s.role, branchId: s.branchId }))];
  const entries: AuditLogEntry[] = [];

  for (let i = 0; i < count; i++) {
    const template = rng.pick(ACTION_TEMPLATES);
    const eligibleActors = actors.filter((a) => template.roles.includes(a.role));
    const actor = rng.pick(eligibleActors.length ? eligibleActors : actors);
    const date = rng.dateOffset(now, -30, 0);
    date.setHours(rng.int(8, 19), rng.int(0, 59), 0, 0);
    entries.push({
      id: padId("AL", 100000 + i + 1, 6),
      actorName: actor.name,
      actorRole: actor.role,
      action: template.action,
      entityType: template.entityType,
      date: date.toISOString(),
      branchId: actor.branchId,
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

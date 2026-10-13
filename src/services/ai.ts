import { delay } from "@/lib/async";
import { formatCurrency, formatDate } from "@/lib/format";
import { DEMO_NOW } from "@/lib/demo-clock";
import { getDb } from "@/store/data-store";
import { getMedicineStatus } from "@/data/seed/pharmacy";
import { SPECIALIZATIONS } from "@/data/pools";
import type { LabReport, Patient, PrescriptionItem } from "@/types";

export const AI_DISCLAIMER = "AI-generated assistance — review before clinical use.";

// ---------------------------------------------------------------------------
// Patient summary
// ---------------------------------------------------------------------------

export interface PatientAISummary {
  overview: string;
  recentVisits: string;
  currentMedications: string;
  recentReports: string;
  recentClinicalNotes: string;
  followUp: string;
  disclaimer: string;
}

export async function generatePatientSummary(patientId: string): Promise<PatientAISummary> {
  await delay(900);
  const db = getDb();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) throw new Error("Patient not found");

  const sixMonthsAgo = new Date(DEMO_NOW);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const recentConsultations = db.consultations
    .filter((c) => c.patientId === patientId && c.status === "completed" && new Date(c.date) >= sixMonthsAgo)
    .sort((a, b) => b.date.localeCompare(a.date));

  const activePrescriptions = db.prescriptions.filter((rx) => rx.patientId === patientId && rx.status === "active");
  const recentReports = db.labReports
    .filter((r) => r.patientId === patientId && r.status === "available")
    .sort((a, b) => b.date.localeCompare(a.date));

  const latest = recentConsultations[0];
  const upcomingFollowUp = recentConsultations.find((c) => c.followUpDate && new Date(c.followUpDate) >= DEMO_NOW);

  return {
    overview: `${patient.age}-year-old ${patient.gender}${patient.chronicConditions.length ? `, managing ${patient.chronicConditions.join(", ").toLowerCase()}` : ""}.`,
    recentVisits: recentConsultations.length
      ? `${recentConsultations.length} consultation${recentConsultations.length > 1 ? "s" : ""} in the last 6 months, most recently on ${formatDate(latest.date)}.`
      : "No consultations recorded in the last 6 months.",
    currentMedications: activePrescriptions.length
      ? `${activePrescriptions.reduce((n, rx) => n + rx.items.length, 0)} active medication(s) across ${activePrescriptions.length} prescription(s).`
      : "No active medications on record.",
    recentReports: recentReports.length
      ? `${recentReports[0].type} performed on ${formatDate(recentReports[0].date)}.`
      : "No recent lab reports on file.",
    recentClinicalNotes: latest?.clinicalNotes
      ? latest.clinicalNotes
      : "No recent clinical notes available for this patient.",
    followUp: upcomingFollowUp?.followUpDate
      ? `Follow-up recommended around ${formatDate(upcomingFollowUp.followUpDate)}.`
      : "No follow-up currently scheduled.",
    disclaimer: AI_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Consultation notes assistant (simulated speech-to-structured-notes)
// ---------------------------------------------------------------------------

export interface ConsultationDraft {
  chiefComplaint: string;
  symptoms: string[];
  temperatureF?: number;
  history: string;
  transcript: string;
}

const SYMPTOM_KEYWORDS = [
  "fever", "cough", "fatigue", "headache", "sore throat", "body ache", "nausea",
  "dizziness", "shortness of breath", "chest discomfort", "joint pain",
  "abdominal pain", "loss of appetite", "skin rash", "vomiting", "diarrhea",
  "running nose", "back pain",
];

export const MOCK_TRANSCRIPT =
  "Patient reports fever for three days, mild cough and fatigue. Temperature is 101°F. No vomiting reported.";

export async function generateConsultationNotes(transcript: string = MOCK_TRANSCRIPT): Promise<ConsultationDraft> {
  await delay(1400);
  const lower = transcript.toLowerCase();
  const symptoms = SYMPTOM_KEYWORDS.filter((k) => lower.includes(k)).map(
    (k) => k.charAt(0).toUpperCase() + k.slice(1)
  );

  const tempMatch = lower.match(/(\d{2,3}(?:\.\d)?)\s?°?\s?f/);
  const temperatureF = tempMatch ? Number(tempMatch[1]) : undefined;

  const durationMatch = lower.match(/for\s+(\w+)\s+(day|days|week|weeks)/);
  const durationText = durationMatch ? `Symptoms present for ${durationMatch[1]} ${durationMatch[2]}.` : "";

  const negations: string[] = [];
  const negationMatches = lower.matchAll(/no\s+([a-z\s]+?)(?:\s+reported)?[.,]/g);
  for (const m of negationMatches) {
    negations.push(`No ${m[1].trim()} reported.`);
  }

  const chiefComplaint = symptoms[0] ? `${symptoms[0]}${durationMatch ? ` for ${durationMatch[1]} ${durationMatch[2]}` : ""}` : "Patient-reported symptoms";

  return {
    chiefComplaint,
    symptoms: symptoms.length ? symptoms : ["Unspecified — please review transcript"],
    temperatureF,
    history: [durationText, ...negations].filter(Boolean).join(" ") || "No additional history captured.",
    transcript,
  };
}

// ---------------------------------------------------------------------------
// Report summary
// ---------------------------------------------------------------------------

export interface ReportAISummary {
  summary: string;
  keyObservations: string[];
  questionsToAsk: string[];
  disclaimer: string;
}

export async function summarizeReport(report: LabReport): Promise<ReportAISummary> {
  await delay(1000);
  if (report.values.length === 0) {
    return {
      summary: `This ${report.type} report has been reviewed. The notes below reflect the reporting clinician's remarks — the displayed findings should be discussed with your doctor for clinical interpretation.`,
      keyObservations: report.notes ? [report.notes] : ["No structured findings were attached to this report."],
      questionsToAsk: [
        "Do these findings require any follow-up action?",
        "Should any further imaging or tests be done?",
      ],
      disclaimer: AI_DISCLAIMER,
    };
  }

  const abnormal = report.values.filter((v) => v.flag !== "normal");
  const keyObservations = abnormal.length
    ? abnormal.map((v) => `${v.parameter} is ${v.flag} at ${v.value} ${v.unit} (reference range: ${v.range}).`)
    : ["All measured parameters fall within the reference range."];

  return {
    summary: `The report contains ${report.values.length} measurement${report.values.length > 1 ? "s" : ""}. ${abnormal.length ? `${abnormal.length} value${abnormal.length > 1 ? "s fall" : " falls"} outside the reference range and` : "All values"} should be reviewed against the reference ranges provided by the laboratory.`,
    keyObservations,
    questionsToAsk: abnormal.length
      ? abnormal.map((v) => `What could be causing the ${v.flag} ${v.parameter.toLowerCase()}, and does it need further testing?`)
      : ["Are there any preventive steps recommended given these normal results?"],
    disclaimer: AI_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// OCR / document extraction
// ---------------------------------------------------------------------------

export interface OcrField {
  label: string;
  value: string;
}

export interface OcrExtractionResult {
  documentType: "prescription" | "lab_report" | "unknown";
  confidence: "high" | "medium" | "low";
  fields: OcrField[];
  disclaimer: string;
}

export async function extractMedicalDocument(fileName: string): Promise<OcrExtractionResult> {
  await delay(1600);
  const name = fileName.toLowerCase();
  if (name.includes("rx") || name.includes("prescription")) {
    return {
      documentType: "prescription",
      confidence: "high",
      fields: [
        { label: "Patient name", value: "Detected from header" },
        { label: "Date", value: formatDate(new Date().toISOString()) },
        { label: "Doctor", value: "Detected from signature block" },
        { label: "Medicines", value: "Paracetamol 500mg, Cetirizine 10mg" },
        { label: "Dosage", value: "1 tablet twice daily" },
      ],
      disclaimer: "Extracted by OCR — confirm every field before saving to the medical record.",
    };
  }
  if (name.includes("report") || name.includes("lab") || name.includes("cbc")) {
    return {
      documentType: "lab_report",
      confidence: "medium",
      fields: [
        { label: "Patient name", value: "Detected from header" },
        { label: "Report date", value: formatDate(new Date().toISOString()) },
        { label: "Report type", value: "CBC" },
        { label: "Key values", value: "Hemoglobin 13.8 g/dL, WBC 7200/cumm" },
      ],
      disclaimer: "Extracted by OCR — confirm every field before saving to the medical record.",
    };
  }
  return {
    documentType: "unknown",
    confidence: "low",
    fields: [{ label: "Document", value: "Could not confidently classify this document." }],
    disclaimer: "Extracted by OCR — confirm every field before saving to the medical record.",
  };
}

// ---------------------------------------------------------------------------
// Prescription safety review
// ---------------------------------------------------------------------------

const INTERACTION_PAIRS: [string, string][] = [
  ["Ibuprofen", "Aspirin"],
  ["Azithromycin", "Levothyroxine"],
  ["Atorvastatin", "Azithromycin"],
];

export async function analyzePrescriptionSafety(patientId: string, items: PrescriptionItem[]): Promise<string[]> {
  await delay(600);
  const flags: string[] = [];
  const names = items.map((i) => i.medicineName);

  const duplicatesWithinOrder = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicatesWithinOrder.length) {
    flags.push(`Duplicate entry detected for ${[...new Set(duplicatesWithinOrder)].join(", ")} in this prescription.`);
  }

  const db = getDb();
  const activeElsewhere = db.prescriptions.filter(
    (rx) => rx.patientId === patientId && rx.status === "active"
  );
  for (const rx of activeElsewhere) {
    for (const existing of rx.items) {
      if (names.includes(existing.medicineName)) {
        flags.push(`${existing.medicineName} is already active in prescription ${rx.id} — verify before duplicating.`);
      }
    }
  }

  for (const [a, b] of INTERACTION_PAIRS) {
    if (names.includes(a) && names.includes(b)) {
      flags.push(`Possible interaction between ${a} and ${b} — clinical review recommended.`);
    }
  }

  return [...new Set(flags)];
}

// ---------------------------------------------------------------------------
// Clinic insights
// ---------------------------------------------------------------------------

export interface AIInsight {
  id: string;
  message: string;
  tone: "positive" | "negative" | "neutral";
}

function daysAgo(n: number): Date {
  const d = new Date(DEMO_NOW);
  d.setDate(d.getDate() - n);
  return d;
}

export async function generateClinicInsights(): Promise<AIInsight[]> {
  await delay(900);
  const db = getDb();
  const isoWeekAgo = daysAgo(7).toISOString().slice(0, 10);
  const isoTwoWeeksAgo = daysAgo(14).toISOString().slice(0, 10);
  const today = DEMO_NOW.toISOString().slice(0, 10);

  const thisWeek = db.appointments.filter((a) => a.date >= isoWeekAgo && a.date <= today);
  const lastWeek = db.appointments.filter((a) => a.date >= isoTwoWeeksAgo && a.date < isoWeekAgo);

  const visitsThisWeek = thisWeek.filter((a) => a.status === "completed").length;
  const visitsLastWeek = lastWeek.filter((a) => a.status === "completed").length;
  const visitChange = visitsLastWeek ? Math.round(((visitsThisWeek - visitsLastWeek) / visitsLastWeek) * 100) : 0;

  const noShowThisWeek = thisWeek.filter((a) => a.status === "no_show").length;
  const noShowLastWeek = lastWeek.filter((a) => a.status === "no_show").length;
  const noShowChange = noShowLastWeek ? Math.round(((noShowThisWeek - noShowLastWeek) / noShowLastWeek) * 100) : noShowThisWeek > 0 ? 100 : 0;

  const hourCounts = new Map<number, number>();
  for (const a of db.appointments) {
    const hour = Number(a.time.split(":")[0]);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const busiestHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const busiestLabel = busiestHour < 12 ? "morning" : busiestHour < 16 ? "early afternoon" : "evening";

  const expiringSoon = db.medicines.filter((m) => getMedicineStatus(m, DEMO_NOW) === "expiring_soon").length;
  const outstanding = db.invoices.reduce((sum, inv) => sum + (inv.status !== "paid" ? inv.balance : 0), 0);

  const followUpThisWeek = thisWeek.filter((a) => a.type === "follow_up").length;
  const followUpLastWeek = lastWeek.filter((a) => a.type === "follow_up").length;
  const followUpChange = followUpLastWeek ? Math.round(((followUpThisWeek - followUpLastWeek) / followUpLastWeek) * 100) : 0;

  const insights: AIInsight[] = [
    {
      id: "visits",
      message: `Patient visits ${visitChange >= 0 ? "increased" : "decreased"} ${Math.abs(visitChange)}% this week compared to last week.`,
      tone: visitChange >= 0 ? "positive" : "negative",
    },
    { id: "busy", message: `Appointments in the ${busiestLabel} are the busiest across the clinic.`, tone: "neutral" },
    {
      id: "noshow",
      message: `No-show rate ${noShowChange >= 0 ? "increased" : "decreased"} ${Math.abs(noShowChange)}% over the last two weeks.`,
      tone: noShowChange > 0 ? "negative" : "positive",
    },
    {
      id: "expiry",
      message: expiringSoon > 0 ? `${expiringSoon} medicine${expiringSoon > 1 ? "s are" : " is"} approaching expiry.` : "No medicines are approaching expiry.",
      tone: expiringSoon > 0 ? "negative" : "positive",
    },
    { id: "outstanding", message: `${formatCurrency(outstanding)} remains outstanding across unpaid invoices.`, tone: outstanding > 0 ? "negative" : "positive" },
    {
      id: "followup",
      message: `Follow-up appointments are ${followUpChange >= 0 ? "up" : "down"} ${Math.abs(followUpChange)}% this week.`,
      tone: followUpChange >= 0 ? "positive" : "negative",
    },
  ];

  return insights;
}

// ---------------------------------------------------------------------------
// Conversational assistants
// ---------------------------------------------------------------------------

export async function answerPatientQuestion(patientId: string, question: string): Promise<string> {
  await delay(700);
  const db = getDb();
  const q = question.toLowerCase();
  const patient = db.patients.find((p) => p.id === patientId) as Patient | undefined;
  if (!patient) return "I couldn't find your patient record.";

  if (/appointment/.test(q)) {
    const upcoming = db.appointments
      .filter((a) => a.patientId === patientId && a.status === "upcoming")
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    if (!upcoming) return "You don't have any upcoming appointments scheduled. Would you like to book one?";
    const doctor = db.doctors.find((d) => d.id === upcoming.doctorId);
    return `Your next appointment is with ${doctor?.name ?? "your doctor"} on ${formatDate(upcoming.date)} at ${upcoming.time}.`;
  }

  if (/prescription|medicine|medication/.test(q)) {
    const latest = db.prescriptions
      .filter((rx) => rx.patientId === patientId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) return "You don't have any prescriptions on file yet.";
    return `Your latest prescription from ${formatDate(latest.date)} includes: ${latest.items.map((i) => i.medicineName).join(", ")}.`;
  }

  if (/report/.test(q)) {
    const latest = db.labReports
      .filter((r) => r.patientId === patientId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) return "You don't have any lab reports on file yet.";
    return latest.status === "available"
      ? `Your ${latest.type} report from ${formatDate(latest.date)} is available in the Reports section.`
      : `Your ${latest.type} report ordered on ${formatDate(latest.date)} is still pending.`;
  }

  if (/owe|payment|bill|due|balance/.test(q)) {
    const outstanding = db.invoices
      .filter((i) => i.patientId === patientId && i.status !== "paid")
      .reduce((sum, i) => sum + i.balance, 0);
    return outstanding > 0
      ? `You have ${formatCurrency(outstanding)} in outstanding payments. You can pay from the Payments section.`
      : "You have no outstanding payments. You're all settled up.";
  }

  if (/reschedule|cancel/.test(q)) {
    return "You can reschedule or cancel any upcoming appointment from the Appointments tab — open the appointment and choose Reschedule or Cancel.";
  }

  return "I can help with appointments, prescriptions, reports, and payments. Try asking something like \"When is my next appointment?\"";
}

export async function answerClinicQuestion(question: string): Promise<string> {
  await delay(800);
  const db = getDb();
  const q = question.toLowerCase();
  const today = DEMO_NOW.toISOString().slice(0, 10);

  if (/most appointments|busiest doctor/.test(q)) {
    const counts = new Map<string, number>();
    for (const a of db.appointments) counts.set(a.doctorId, (counts.get(a.doctorId) ?? 0) + 1);
    const [topId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    const doctor = db.doctors.find((d) => d.id === topId);
    return doctor ? `${doctor.name} has the most appointments, with ${count} in total.` : "I couldn't determine that right now.";
  }

  if (/revenue/.test(q)) {
    const weekAgo = daysAgo(7).toISOString().slice(0, 10);
    const twoWeeksAgo = daysAgo(14).toISOString().slice(0, 10);
    const thisWeek = db.payments.filter((p) => p.date >= weekAgo && p.date <= today).reduce((s, p) => s + p.amount, 0);
    const lastWeek = db.payments.filter((p) => p.date >= twoWeeksAgo && p.date < weekAgo).reduce((s, p) => s + p.amount, 0);
    const change = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
    return `Revenue this week is ${formatCurrency(thisWeek)}, which is ${Math.abs(change)}% ${change >= 0 ? "higher" : "lower"} than last week (${formatCurrency(lastWeek)}).`;
  }

  if (/waiting/.test(q)) {
    const count = db.appointments.filter((a) => a.date === today && (a.status === "waiting" || a.status === "in_consultation")).length;
    return `${count} patient${count === 1 ? " is" : "s are"} currently waiting or in consultation today.`;
  }

  if (/low stock|medicine|inventory/.test(q)) {
    const low = db.medicines.filter((m) => ["low_stock", "out_of_stock"].includes(getMedicineStatus(m, DEMO_NOW)));
    if (!low.length) return "No medicines are currently low in stock.";
    return `${low.length} medicine(s) are low in stock: ${low.slice(0, 5).map((m) => m.name).join(", ")}${low.length > 5 ? ", and more" : ""}.`;
  }

  if (/missed|no.show/.test(q)) {
    const monthAgo = daysAgo(30).toISOString().slice(0, 10);
    const count = db.appointments.filter((a) => a.status === "no_show" && a.date >= monthAgo).length;
    return `${count} appointment${count === 1 ? "" : "s"} were marked as no-show in the last 30 days.`;
  }

  if (/outstanding|pending payment|unpaid/.test(q)) {
    const unpaid = db.invoices.filter((i) => i.status !== "paid");
    const total = unpaid.reduce((s, i) => s + i.balance, 0);
    return `${formatCurrency(total)} is outstanding across ${unpaid.length} invoice(s).`;
  }

  if (/service|category/.test(q) && /revenue|most/.test(q)) {
    const byCategory = new Map<string, number>();
    for (const inv of db.invoices) {
      for (const item of inv.items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.amount);
    }
    const [topCategory, amount] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    return topCategory ? `${topCategory.replace("_", " ")} generated the most revenue, at ${formatCurrency(amount)}.` : "No billing data available yet.";
  }

  return "I can answer questions about doctor workload, revenue, waiting patients, low-stock medicines, missed appointments, and outstanding payments. Try one of the suggested questions.";
}

// ---------------------------------------------------------------------------
// Public assistant (anonymous visitors on the marketing site)
// ---------------------------------------------------------------------------

export async function answerPublicQuestion(question: string): Promise<string> {
  await delay(700);
  const db = getDb();
  const q = question.toLowerCase();

  const specialtyMatch = SPECIALIZATIONS.find((s) => q.includes(s.toLowerCase()) || q.includes(s.toLowerCase().split(" ")[0]));
  if (specialtyMatch || /doctor|specialist|dermatologist|cardiologist|pediatrician|gynaecologist|gynecologist/.test(q)) {
    const specialty = specialtyMatch ?? SPECIALIZATIONS.find((s) => q.includes(s.slice(0, 5).toLowerCase()));
    const pool = specialty ? db.doctors.filter((d) => d.specialization === specialty && d.status === "active") : db.doctors.filter((d) => d.status === "active");
    const count = pool.length;
    if (specialty) {
      return `I found ${count} ${specialty.toLowerCase()} specialist${count === 1 ? "" : "s"} on Sehat Setu. Would you like to view them and book an appointment?`;
    }
    return `Sehat Setu has ${count} doctors across ${SPECIALIZATIONS.length} specialties. Tell me a specialty (like "dermatologist" or "cardiologist") or browse the doctor directory to find the right one.`;
  }

  if (/book|appointment|schedule/.test(q)) {
    return `Booking takes about a minute: search for a doctor or specialty, pick an available date and time, and confirm — you can pay online or at the clinic. Want me to help you find a doctor first?`;
  }

  if (/online|video|consult/.test(q)) {
    const onlineDoctors = db.doctors.filter((d) => d.onlineConsultation && d.status === "active").length;
    return `${onlineDoctors} of our doctors offer online video consultations. You can choose "Online" as the consultation type when booking.`;
  }

  if (/location|city|near|clinic/.test(q)) {
    const cities = [...new Set(db.branches.map((b) => b.city))];
    return `Sehat Setu clinics are located in ${cities.join(", ")}. You can filter doctors by location from the Find a Doctor page.`;
  }

  if (/price|fee|cost|charge/.test(q)) {
    const fees = db.doctors.filter((d) => d.status === "active").map((d) => d.consultationFee);
    const min = Math.min(...fees);
    const max = Math.max(...fees);
    return `Consultation fees range from ${formatCurrency(min)} to ${formatCurrency(max)} depending on the doctor and specialty — the exact fee is always shown before you pay.`;
  }

  if (/report|prescription|record|portal/.test(q)) {
    return "Once you have an account, your prescriptions, lab reports, and appointment history are all available in your patient portal — sign in or register to access it.";
  }

  return "I can help you find a doctor, understand consultation fees, or explain how booking and online consultations work. What would you like to do?";
}

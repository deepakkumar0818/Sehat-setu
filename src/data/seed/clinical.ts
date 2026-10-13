import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type {
  Appointment,
  Consultation,
  Doctor,
  LabReport,
  LabReportValue,
  Patient,
  PatientDocument,
  Prescription,
  PrescriptionItem,
} from "@/types";
import { CBC_PARAMETERS, DIAGNOSES, LIPID_PARAMETERS, MEDICINES, SYMPTOMS } from "@/data/pools";

function buildVitals(rng: Rng, ageYears: number) {
  const heightCm = ageYears < 12 ? rng.int(90, 150) : rng.int(150, 188);
  const weightKg = ageYears < 12 ? rng.int(12, 45) : rng.int(45, 95);
  const bmi = Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
  return {
    temperatureF: rng.float(97.2, 102.4, 1),
    bpSystolic: rng.int(105, 148),
    bpDiastolic: rng.int(68, 94),
    heartRate: rng.int(62, 104),
    spo2: rng.int(95, 99),
    weightKg,
    heightCm,
    bmi,
  };
}

const INSTRUCTIONS = ["After food", "Before food", "With plenty of water", "At bedtime", ""];
const FREQUENCIES = ["Once daily", "Twice daily", "3 times daily", "Every 8 hours", "As needed"];
const DURATIONS = ["3 days", "5 days", "7 days", "10 days", "15 days", "30 days"];
const DOSAGES = ["1 tablet", "2 tablets", "1 capsule", "5 ml", "10 ml", "1 sachet"];
const ROUTES = ["Oral", "Topical", "Inhalation"];

function randomPrescriptionItem(rng: Rng): PrescriptionItem {
  const med = rng.pick(MEDICINES);
  return {
    medicineName: med.name,
    strength: med.strength,
    dosage: rng.pick(DOSAGES),
    frequency: rng.pick(FREQUENCIES),
    duration: rng.pick(DURATIONS),
    route: med.name.toLowerCase().includes("gel") ? "Topical" : med.name.toLowerCase().includes("inhaler") ? "Inhalation" : ROUTES[0],
    instructions: rng.pick(INSTRUCTIONS) || undefined,
  };
}

function buildLabValues(rng: Rng, type: LabReport["type"]): LabReportValue[] {
  const params = type === "CBC" ? CBC_PARAMETERS : type === "Lipid Profile" ? LIPID_PARAMETERS : [];
  return params.map((p) => {
    const flag = rng.weighted<LabReportValue["flag"]>([
      ["normal", 75],
      ["high", 15],
      ["low", 10],
    ]);
    const base = flag === "normal" ? rng.float(0.9, 1.05, 2) : flag === "high" ? rng.float(1.1, 1.4, 2) : rng.float(0.5, 0.85, 2);
    const numericRange = p.range.match(/[\d.]+/g)?.map(Number) ?? [10, 20];
    const mid = numericRange.length === 2 ? (numericRange[0] + numericRange[1]) / 2 : numericRange[0];
    const value = Math.round(mid * base * 10) / 10;
    return { parameter: p.parameter, unit: p.unit, range: p.range, flag, value: String(value) };
  });
}

const IMAGING_NOTES: Record<string, string[]> = {
  "X-Ray": ["No acute bony abnormality seen.", "Mild degenerative changes noted.", "Findings within normal limits."],
  MRI: ["No significant abnormality detected.", "Mild disc bulge noted, clinical correlation advised."],
  "CT Scan": ["No acute intracranial abnormality.", "Findings are unremarkable."],
  Ultrasound: ["Liver, gallbladder, and kidneys appear normal.", "No free fluid collection seen."],
  ECG: ["Normal sinus rhythm.", "No ST-T changes noted."],
  Other: ["Results reviewed, no critical findings."],
};

interface ClinicalResult {
  consultations: Consultation[];
  prescriptions: Prescription[];
  labReports: LabReport[];
  documents: PatientDocument[];
}

export function generateClinicalRecords(
  rng: Rng,
  appointments: Appointment[],
  patients: Patient[],
  doctors: Doctor[],
  now: Date
): ClinicalResult {
  const patientsById = new Map(patients.map((p) => [p.id, p]));
  const consultations: Consultation[] = [];
  const prescriptions: Prescription[] = [];
  const labReports: LabReport[] = [];
  const documents: PatientDocument[] = [];

  let consultationCounter = 1;
  let prescriptionCounter = 1;
  let reportCounter = 1;
  let documentCounter = 1;

  const candidates = appointments.filter(
    (a) => a.status === "completed" || a.status === "in_consultation"
  );

  for (const appt of candidates) {
    const isDone = appt.status === "completed";
    if (isDone && !rng.bool(0.7)) continue;

    const patient = patientsById.get(appt.patientId)!;
    const doctor = doctors.find((d) => d.id === appt.doctorId)!;
    const symptoms = rng.pickMany(SYMPTOMS, rng.int(2, 4));
    const diagnosis = isDone ? rng.pickMany(DIAGNOSES, rng.int(1, 2)) : [];
    const orderLabs = isDone && rng.bool(0.4);
    const labTestsOrdered = orderLabs ? rng.pickMany(["CBC", "LFT", "Lipid Profile", "KFT"], rng.int(1, 2)) : [];
    const followUp = isDone && rng.bool(0.4);

    const consultation: Consultation = {
      id: padId("CN", 100000 + consultationCounter++, 6),
      appointmentId: appt.id,
      patientId: patient.id,
      doctorId: doctor.id,
      branchId: appt.branchId,
      date: appt.date,
      chiefComplaint: appt.reason,
      symptoms,
      history: rng.bool(0.5) ? `Symptoms started ${rng.int(1, 6)} days ago. No similar episodes in the past.` : undefined,
      allergiesNoted: patient.allergies.length ? patient.allergies : rng.bool(0.6) ? ["No known allergies"] : [],
      vitals: buildVitals(rng, patient.age),
      examination: isDone ? "General physical examination unremarkable apart from findings noted above." : undefined,
      diagnosis,
      clinicalNotes: isDone
        ? `Patient presented with ${symptoms.slice(0, 2).join(" and ").toLowerCase()}. Examination and history are consistent with ${diagnosis[0]?.toLowerCase() ?? "the working diagnosis"}. Advised symptomatic management and review if symptoms persist.`
        : "Consultation in progress.",
      treatmentPlan: isDone ? "Symptomatic treatment prescribed. Rest and hydration advised." : undefined,
      labTestsOrdered,
      followUpDate: followUp ? rng.dateOffset(now, appt.date === now.toISOString().slice(0, 10) ? 7 : 3, 14).toISOString().slice(0, 10) : undefined,
      status: isDone ? "completed" : "in_progress",
    };

    if (isDone && rng.bool(0.85)) {
      const items = Array.from({ length: rng.int(1, 3) }, () => randomPrescriptionItem(rng));
      const aiReviewFlags: string[] = [];
      if (rng.bool(0.12)) aiReviewFlags.push("Potential duplicate medication detected — please verify against active prescriptions.");
      if (rng.bool(0.08)) aiReviewFlags.push("Possible interaction between prescribed items requires clinical review.");

      const prescription: Prescription = {
        id: padId("RX", 100000 + prescriptionCounter++, 6),
        patientId: patient.id,
        doctorId: doctor.id,
        consultationId: consultation.id,
        date: appt.date,
        items,
        notes: rng.bool(0.3) ? "Review after course completion if symptoms persist." : undefined,
        status: "active",
        aiReviewFlags,
      };
      prescriptions.push(prescription);
      consultation.prescriptionId = prescription.id;
      documents.push({
        id: padId("DOC", 100000 + documentCounter++, 6),
        patientId: patient.id,
        category: "prescription",
        title: `Prescription — ${appt.date}`,
        date: appt.date,
        refId: prescription.id,
        sizeKb: rng.int(80, 260),
      });
    }

    for (const testType of labTestsOrdered) {
      const reportDate = rng.dateOffset(new Date(appt.date), 0, 2).toISOString().slice(0, 10);
      const isAvailable = new Date(reportDate) <= now;
      const report: LabReport = {
        id: padId("LR", 100000 + reportCounter++, 6),
        patientId: patient.id,
        doctorId: doctor.id,
        consultationId: consultation.id,
        type: testType as LabReport["type"],
        title: `${testType} Report`,
        date: reportDate,
        status: isAvailable ? "available" : "pending",
        values: buildLabValues(rng, testType as LabReport["type"]),
        notes: rng.pick(IMAGING_NOTES[testType] ?? IMAGING_NOTES.Other),
        sharedWithPatient: isAvailable && rng.bool(0.8),
      };
      labReports.push(report);
      if (isAvailable) {
        documents.push({
          id: padId("DOC", 100000 + documentCounter++, 6),
          patientId: patient.id,
          category: "lab_report",
          title: report.title,
          date: report.date,
          refId: report.id,
          sizeKb: rng.int(200, 1800),
        });
      }
    }

    consultations.push(consultation);
  }

  // Standalone refill prescriptions for patients managing chronic conditions —
  // several refills per patient over time, not just one, to reflect ongoing
  // management of a chronic condition.
  const chronicPatients = patients.filter((p) => p.chronicConditions.length > 0);
  const refillPatients = chronicPatients.flatMap((patient) => Array(rng.int(1, 3)).fill(patient));
  for (const patient of refillPatients) {
    const doctor = rng.pick(doctors.filter((d) => d.branchId === patient.branchId));
    if (!doctor) continue;
    const date = rng.dateOffset(now, -120, -1).toISOString().slice(0, 10);
    const prescription: Prescription = {
      id: padId("RX", 100000 + prescriptionCounter++, 6),
      patientId: patient.id,
      doctorId: doctor.id,
      date,
      items: [randomPrescriptionItem(rng)],
      notes: "Continuing medication refill for ongoing management.",
      status: "active",
      aiReviewFlags: [],
    };
    prescriptions.push(prescription);
    documents.push({
      id: padId("DOC", 100000 + documentCounter++, 6),
      patientId: patient.id,
      category: "prescription",
      title: `Prescription — ${date}`,
      date,
      refId: prescription.id,
      sizeKb: rng.int(80, 260),
    });
  }

  // Standalone lab reports not tied to a specific consultation.
  const allTypes: LabReport["type"][] = ["CBC", "LFT", "KFT", "Lipid Profile", "X-Ray", "Ultrasound", "ECG"];
  for (let i = 0; i < 60; i++) {
    const patient = rng.pick(patients);
    const doctor = rng.bool(0.7) ? rng.pick(doctors.filter((d) => d.branchId === patient.branchId)) : undefined;
    const type = rng.pick(allTypes);
    const date = rng.dateOffset(now, -45, -1).toISOString().slice(0, 10);
    const report: LabReport = {
      id: padId("LR", 100000 + reportCounter++, 6),
      patientId: patient.id,
      doctorId: doctor?.id,
      type,
      title: `${type} Report`,
      date,
      status: "available",
      values: buildLabValues(rng, type),
      notes: rng.pick(IMAGING_NOTES[type] ?? IMAGING_NOTES.Other),
      sharedWithPatient: rng.bool(0.8),
    };
    labReports.push(report);
    documents.push({
      id: padId("DOC", 100000 + documentCounter++, 6),
      patientId: patient.id,
      category: "lab_report",
      title: report.title,
      date: report.date,
      refId: report.id,
      sizeKb: rng.int(200, 1800),
    });
  }

  // A handful of miscellaneous documents (referrals, ID proofs).
  const miscCategories: PatientDocument["category"][] = ["referral", "id_proof", "other"];
  for (let i = 0; i < 20; i++) {
    const patient = rng.pick(patients);
    const category = rng.pick(miscCategories);
    const date = rng.dateOffset(now, -200, -1).toISOString().slice(0, 10);
    documents.push({
      id: padId("DOC", 100000 + documentCounter++, 6),
      patientId: patient.id,
      category,
      title: category === "referral" ? "Referral Letter" : category === "id_proof" ? "ID Proof" : "Miscellaneous Document",
      date,
      sizeKb: rng.int(50, 500),
    });
  }

  // Reflect newly created consultations back onto their source appointments.
  const consultationByAppointment = new Map(consultations.map((c) => [c.appointmentId, c]));
  for (const appt of appointments) {
    const c = consultationByAppointment.get(appt.id);
    if (c) appt.consultationId = c.id;
  }

  return { consultations, prescriptions, labReports, documents };
}

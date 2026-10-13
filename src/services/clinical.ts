import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { analyzePrescriptionSafety } from "@/services/ai";
import type {
  Consultation,
  ConsultationStatus,
  DocumentCategory,
  LabReport,
  LabReportType,
  PatientDocument,
  Prescription,
  PrescriptionItem,
  PrescriptionStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Consultations
// ---------------------------------------------------------------------------

export interface ListConsultationsParams {
  search?: string;
  doctorId?: string | "all";
  patientId?: string;
  status?: ConsultationStatus | "all";
  page?: number;
  pageSize?: number;
}

export interface ConsultationWithNames extends Consultation {
  patientName: string;
  doctorName: string;
  // Clinic-database detail fields (demo pages read these from the mock store).
  patientNumber?: string;
  patientAge?: number;
  patientGender?: string;
  patientAvatarColor?: string;
  /** UI hints only; the server re-checks: edit = assigned doctor and in progress. */
  capabilities?: { edit: boolean; prescribe: boolean };
}

function enrichConsultation(c: Consultation): ConsultationWithNames {
  const db = getDb();
  return {
    ...c,
    patientName: db.patients.find((p) => p.id === c.patientId)?.name ?? "Unknown patient",
    doctorName: db.doctors.find((d) => d.id === c.doctorId)?.name ?? "Unknown doctor",
  };
}

export async function listConsultations(params: ListConsultationsParams = {}): Promise<PagedResult<ConsultationWithNames>> {
  await delay();
  const { search = "", doctorId = "all", patientId, status = "all", page = 1, pageSize = 10 } = params;
  const items = getDb()
    .consultations.filter((c) => {
      if (doctorId !== "all" && c.doctorId !== doctorId) return false;
      if (patientId && c.patientId !== patientId) return false;
      if (status !== "all" && c.status !== status) return false;
      return true;
    })
    .map(enrichConsultation)
    .filter((c) => matchesSearch([c.patientName, c.doctorName, c.chiefComplaint, c.id], search))
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function getConsultation(id: string): Promise<ConsultationWithNames | undefined> {
  await delay(250);
  const found = getDb().consultations.find((c) => c.id === id);
  return found ? enrichConsultation(found) : undefined;
}

export async function updateConsultation(id: string, patch: Partial<Consultation>): Promise<Consultation> {
  await delay(300);
  let updated: Consultation | undefined;
  mutateDb((d) => ({
    ...d,
    consultations: d.consultations.map((c) => {
      if (c.id !== id) return c;
      updated = { ...c, ...patch };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Consultation not found");
  return updated;
}

export async function completeConsultation(id: string, patch: Partial<Consultation>): Promise<Consultation> {
  await delay(450);
  const consultation = await updateConsultation(id, { ...patch, status: "completed" });
  mutateDb((d) => ({
    ...d,
    appointments: d.appointments.map((a) =>
      a.id === consultation.appointmentId ? { ...a, status: "completed" as const } : a
    ),
    patients: d.patients.map((p) => (p.id === consultation.patientId ? { ...p, lastVisit: consultation.date } : p)),
  }));
  return consultation;
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

export interface ListPrescriptionsParams {
  search?: string;
  doctorId?: string | "all";
  patientId?: string;
  status?: PrescriptionStatus | "all";
  page?: number;
  pageSize?: number;
}

export interface PrescriptionWithNames extends Prescription {
  patientName: string;
  doctorName: string;
  // Clinic-database detail fields (demo pages read these from the mock store).
  prescriptionNumber?: string;
  patientNumber?: string;
  patientAge?: number;
  patientGender?: string;
  patientAllergies?: string[];
  doctorQualifications?: string;
  doctorRegistration?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
}

function enrichPrescription(rx: Prescription): PrescriptionWithNames {
  const db = getDb();
  return {
    ...rx,
    patientName: db.patients.find((p) => p.id === rx.patientId)?.name ?? "Unknown patient",
    doctorName: db.doctors.find((d) => d.id === rx.doctorId)?.name ?? "Unknown doctor",
  };
}

export async function listPrescriptions(params: ListPrescriptionsParams = {}): Promise<PagedResult<PrescriptionWithNames>> {
  await delay();
  const { search = "", doctorId = "all", patientId, status = "all", page = 1, pageSize = 10 } = params;
  const items = getDb()
    .prescriptions.filter((rx) => {
      if (doctorId !== "all" && rx.doctorId !== doctorId) return false;
      if (patientId && rx.patientId !== patientId) return false;
      if (status !== "all" && rx.status !== status) return false;
      return true;
    })
    .map(enrichPrescription)
    .filter((rx) => matchesSearch([rx.patientName, rx.doctorName, rx.id], search))
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function getPrescription(id: string): Promise<PrescriptionWithNames | undefined> {
  await delay(250);
  const found = getDb().prescriptions.find((rx) => rx.id === id);
  return found ? enrichPrescription(found) : undefined;
}

export interface CreatePrescriptionInput {
  patientId: string;
  doctorId: string;
  consultationId?: string;
  items: PrescriptionItem[];
  notes?: string;
}

/** Clinic database: items reference the medicine catalogue; the prescriber is always the signed-in assigned doctor. */
export interface CreateLivePrescriptionInput {
  consultationId: string;
  items: { medicineId: string; dosage: string; frequency: string; durationDays: number; route?: string; instructions?: string }[];
  notes?: string;
}

/** A medicine catalogue entry (shared by every clinic). */
export interface CatalogMedicine {
  id: string;
  name: string;
  genericName: string;
  strength: string;
  dosageForm: string;
}

/** One page of a catalogue search. `canCreate` is a UI hint; the server and database re-check. */
export interface CatalogPage {
  items: CatalogMedicine[];
  total: number;
  page: number;
  pageSize: number;
  canCreate: boolean;
}

export interface CreateCatalogMedicineInput {
  name: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  confirmGenericMatch?: boolean;
}

export async function createPrescription(input: CreatePrescriptionInput): Promise<Prescription> {
  await delay(400);
  const db = getDb();
  const aiReviewFlags = await analyzePrescriptionSafety(input.patientId, input.items);

  const prescription: Prescription = {
    id: padId("RX", 100000 + db.prescriptions.length + 1, 6),
    patientId: input.patientId,
    doctorId: input.doctorId,
    consultationId: input.consultationId,
    date: new Date().toISOString().slice(0, 10),
    items: input.items,
    notes: input.notes,
    status: "active",
    aiReviewFlags,
  };

  mutateDb((d) => ({
    ...d,
    prescriptions: [prescription, ...d.prescriptions],
    consultations: input.consultationId
      ? d.consultations.map((c) => (c.id === input.consultationId ? { ...c, prescriptionId: prescription.id } : c))
      : d.consultations,
    documents: [
      {
        id: padId("DOC", 100000 + d.documents.length + 1, 6),
        patientId: input.patientId,
        category: "prescription" as DocumentCategory,
        title: `Prescription — ${prescription.date}`,
        date: prescription.date,
        refId: prescription.id,
        sizeKb: 120,
      },
      ...d.documents,
    ],
  }));

  return prescription;
}

// ---------------------------------------------------------------------------
// Lab reports
// ---------------------------------------------------------------------------

export interface ListReportsParams {
  search?: string;
  type?: LabReportType | "all";
  patientId?: string;
  status?: LabReport["status"] | "all";
  page?: number;
  pageSize?: number;
}

export interface LabReportWithNames extends LabReport {
  patientName: string;
}

function enrichReport(r: LabReport): LabReportWithNames {
  const db = getDb();
  return { ...r, patientName: db.patients.find((p) => p.id === r.patientId)?.name ?? "Unknown patient" };
}

export async function listReports(params: ListReportsParams = {}): Promise<PagedResult<LabReportWithNames>> {
  await delay();
  const { search = "", type = "all", patientId, status = "all", page = 1, pageSize = 10 } = params;
  const items = getDb()
    .labReports.filter((r) => {
      if (type !== "all" && r.type !== type) return false;
      if (patientId && r.patientId !== patientId) return false;
      if (status !== "all" && r.status !== status) return false;
      return true;
    })
    .map(enrichReport)
    .filter((r) => matchesSearch([r.patientName, r.title, r.id], search))
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function getReport(id: string): Promise<LabReportWithNames | undefined> {
  await delay(250);
  const found = getDb().labReports.find((r) => r.id === id);
  return found ? enrichReport(found) : undefined;
}

export interface CreateReportInput {
  patientId: string;
  type: LabReportType;
  title: string;
  notes?: string;
}

export async function createReport(input: CreateReportInput): Promise<LabReport> {
  await delay(500);
  const db = getDb();
  const report: LabReport = {
    id: padId("LR", 100000 + db.labReports.length + 1, 6),
    patientId: input.patientId,
    type: input.type,
    title: input.title,
    date: new Date().toISOString().slice(0, 10),
    status: "available",
    values: [],
    notes: input.notes,
    sharedWithPatient: false,
  };
  mutateDb((d) => ({
    ...d,
    labReports: [report, ...d.labReports],
    documents: [
      {
        id: padId("DOC", 100000 + d.documents.length + 1, 6),
        patientId: input.patientId,
        category: "lab_report" as DocumentCategory,
        title: report.title,
        date: report.date,
        refId: report.id,
        sizeKb: 640,
      },
      ...d.documents,
    ],
  }));
  return report;
}

export async function shareReportWithPatient(id: string): Promise<void> {
  await delay(300);
  mutateDb((d) => ({ ...d, labReports: d.labReports.map((r) => (r.id === id ? { ...r, sharedWithPatient: true } : r)) }));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface ListDocumentsParams {
  search?: string;
  category?: DocumentCategory | "all";
  patientId?: string;
  page?: number;
  pageSize?: number;
}

export async function listDocuments(params: ListDocumentsParams = {}): Promise<PagedResult<PatientDocument>> {
  await delay();
  const { search = "", category = "all", patientId, page = 1, pageSize = 12 } = params;
  const items = getDb()
    .documents.filter((doc) => {
      if (category !== "all" && doc.category !== category) return false;
      if (patientId && doc.patientId !== patientId) return false;
      return matchesSearch([doc.title, doc.id], search);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

// Typed calls to the clinic database API (/api/v1). Mirrors the signatures of
// the mock services in src/services so hooks can switch between them; this
// module imports nothing from the mock store.
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost, apiPut, toQuery } from "@/lib/api-client";
import type { PagedResult } from "@/lib/async";
import type { AppointmentWithNames, CreateAppointmentInput, ListAppointmentsParams } from "@/services/appointments";
import type { BillingSummary, CreateManualInvoiceInput, InvoiceWithNames, ListInvoicesParams, ListPaymentsParams } from "@/services/billing";
import type { CreatePatientInput, ListPatientsParams } from "@/services/patients";
import type { PatientReportedView } from "@/lib/patient-intake";
import type { ListStockParams, LiveInventorySummary, ReceiveStockInput, StockDetail, StockRow } from "@/services/inventory";
import type {
  CatalogMedicine,
  CatalogPage,
  ConsultationWithNames,
  CreateCatalogMedicineInput,
  CreateLivePrescriptionInput,
  ListConsultationsParams,
  ListPrescriptionsParams,
  PrescriptionWithNames,
} from "@/services/clinical";
import type { ListDoctorsParams, ListStaffParams } from "@/services/people";
import type { GlobalSearchResults } from "@/services/search";
import type {
  CreateInvitationInput,
  InvitationPage,
  InvitationResult,
  MyInvitation,
  NotificationPage,
  SpecialtyOption,
  StaffCapabilities,
  StaffInvitation,
  UnreadCount,
  FinancialReport,
  OperationalReport,
  DocumentPage,
  LabReportPage,
  LiveDocument,
  LiveLabReportDetail,
  UploadResult,
  PortalDocument,
  PortalLabReport,
  PortalLabReportDetail,
  PortalSummary,
  PortalAppointment,
  PortalAppointmentScope,
  PortalBookingOptions,
  PortalClinicRecord,
  PortalClinicContact,
  CheckoutOptions,
  OnlinePaymentResult,
  RefundAttention,
  PortalDashboard,
  PortalInvoice,
  PortalLinkCode,
  PortalLinkStatus,
  AuditPage,
  AuditArea,
  BranchInput,
  ClinicProfile,
  ClinicProfileInput,
  ClinicSettings,
  ClinicSettingsPage,
  PlatformActivityKind,
  PlatformActivityPage,
  PlatformClinicCreated,
  PlatformClinicDetail,
  PlatformClinicInput,
  PlatformClinicProfileInput,
  PlatformOverview,
  PlatformPaymentsPage,
  PlatformPaymentTotals,
  PlatformPlan,
  PlatformSettingsInfo,
  PlatformPlanInput,
  PlatformSubscriptionInput,
  SubscriptionPaymentInput,
  DepartmentInput,
  DepartmentPage,
  LabTestCategory,
  LabTestPage,
  LiveLabTest,
  ClinicUsersPage,
  SpecialtyUsagePage,
  ExpenseInput,
  ExpensePage,
  LiveDepartment,
  LiveExpense,
  LiveExpenseCategory,
  LiveSpecialty,
  BookingRequestPage,
} from "@/lib/live-types";

import type { ArchiveReason, DocumentCategoryKey, LabValue } from "@/lib/documents";
import type { ReportExportKey } from "@/lib/reports";
import type { Branch, Consultation, Doctor, Patient, Payment, PatientStatus, PaymentMethod, StaffMember, TimelineEvent, UserRole } from "@/types";

export interface PortalPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const CONSULTATION_EDITABLE = [
  "chiefComplaint", "symptoms", "history", "allergiesNoted", "vitals", "examination", "diagnosis", "clinicalNotes", "treatmentPlan", "labTestsOrdered",
] as const;

/** Only the editable fields; an emptied follow-up date is sent as null so it's cleared. BMI is computed by the server. */
function consultationPatch(patch: Partial<Consultation>) {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([k]) => (CONSULTATION_EDITABLE as readonly string[]).includes(k)));
  if (patch.vitals) {
    const measured: Record<string, unknown> = { ...patch.vitals };
    delete measured.bmi;
    body.vitals = Object.fromEntries(Object.entries(measured).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
  }
  if ("followUpDate" in patch) body.followUpDate = patch.followUpDate || null;
  return body;
}

/** Rupees as typed in the UI → integer paise for the API (the server validates and computes all totals). */
const toPaise = (rupees: number) => Math.round(rupees * 100);

const PATIENT_EDITABLE = ["name", "phone", "email", "address", "city", "bloodGroup", "allergies", "chronicConditions", "status", "emergencyContact"] as const;

export interface ReportParams {
  from: string;
  to: string;
  branchId?: string;
}

/** Downloads one report as CSV (the server re-checks reports.export and records the export). */
async function downloadReport(report: ReportExportKey, params: ReportParams): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/reports/export${toQuery({ report, ...params })}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? "The export failed. Please try again.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${report}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- P6.2: patient documents and lab reports -------------------------------------

export interface ListDocumentsParams {
  kind?: "all" | "clinical" | "administrative";
  category?: DocumentCategoryKey | "all";
  status?: "available" | "archived" | "all";
  search?: string;
  labReportId?: string;
  page?: number;
  pageSize?: number;
}

export interface UploadDocumentInput {
  patientId: string;
  file: File;
  category: DocumentCategoryKey;
  title: string;
  labReportId?: string;
  consultationId?: string;
  /** LAB_REPORT without labReportId: also registers a lab report for this file. */
  testType?: string;
}

/** Multipart upload with real progress (XHR). Errors are thrown as ApiRequestError, never swallowed. */
function uploadDocument(input: UploadDocumentInput, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("category", input.category);
  form.set("title", input.title);
  if (input.labReportId) form.set("labReportId", input.labReportId);
  if (input.consultationId) form.set("consultationId", input.consultationId);
  if (input.testType) form.set("testType", input.testType);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/patients/${encodeURIComponent(input.patientId)}/documents`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again."));
    xhr.onload = () => {
      const json = xhr.response as { error?: { code?: string; message?: string; details?: unknown } } | UploadResult | null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(json as UploadResult);
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      reject(new ApiRequestError(xhr.status, err?.code ?? `HTTP_${xhr.status}`, err?.message ?? "The upload failed. Please try again.", err?.details));
    };
    xhr.send(form);
  });
}

/** Fetches a document's bytes through the authorized, audited server route. */
async function fetchDocumentBlob(id: string, disposition: "inline" | "attachment"): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/file?disposition=${disposition}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? "The file couldn't be opened.");
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  const filename = star ? decodeURIComponent(star) : (/filename="([^"]+)"/.exec(cd)?.[1] ?? "document");
  return { blob: await res.blob(), filename };
}

async function downloadDocument(id: string): Promise<void> {
  const { blob, filename } = await fetchDocumentBlob(id, "attachment");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** An image for in-page preview (object URL; the caller revokes it). */
async function previewDocument(id: string): Promise<string> {
  const { blob } = await fetchDocumentBlob(id, "inline");
  return URL.createObjectURL(blob);
}

export interface ListLabReportsParams {
  patientId?: string;
  status?: "PENDING" | "AVAILABLE" | "REVIEWED" | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateLabReportInput {
  patientId: string;
  testType: string;
  title: string;
  consultationId?: string;
}

export interface SetLabValuesInput {
  values: LabValue[];
  resultDate?: string | null;
  notes?: string | null;
}

// --- P6.3: patient portal ----------------------------------------------------------

/** A file of the patient's own shared report, through the authorized, audited portal route. */
async function fetchPortalFile(id: string, disposition: "inline" | "attachment"): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/portal/documents/${encodeURIComponent(id)}/file?disposition=${disposition}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? "The file couldn't be opened.");
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  const filename = star ? decodeURIComponent(star) : (/filename="([^"]+)"/.exec(cd)?.[1] ?? "document");
  return { blob: await res.blob(), filename };
}

async function downloadPortalFile(id: string): Promise<void> {
  const { blob, filename } = await fetchPortalFile(id, "attachment");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the booking form sends: never a patient or clinic id. */
export interface PortalBookingRequest {
  branchId: string;
  doctorId: string;
  date: string;
  time: string;
  reason: string;
  type: "in_person" | "online";
  symptoms?: { requestId: string; symptoms: string; onset: string; severity?: string | null } | null;
}

export const liveApi = {
  account: {
    /** The current password is checked on the server before the new one is saved; other devices are signed out. */
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      apiPost<{ ok: true; otherSessionsSignedOut: boolean }>("/api/v1/me/password", input),
  },
  platform: {
    overview: () => apiGet<PlatformOverview>("/api/v1/platform/clinics"),
    createClinic: (input: PlatformClinicInput) => apiPost<PlatformClinicCreated>("/api/v1/platform/clinics", input),
    setStatus: (id: string, status: "active" | "suspended") => apiPatch<{ ok: true }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}`, { status }),
    resendInvite: (id: string, email: string) => apiPost<{ sent: boolean; problem: string | null }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/invite`, { email }),
    clinic: (id: string) => apiGet<PlatformClinicDetail>(`/api/v1/platform/clinics/${encodeURIComponent(id)}`),
    updateClinic: (id: string, input: PlatformClinicProfileInput) => apiPut<{ ok: true }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/profile`, input),
    addAdmin: (id: string, input: { name: string; email: string }) =>
      apiPost<{ adminIsNew: boolean; invitationSent: boolean | null; invitationProblem: string | null }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/admins`, input),
    removeAdmin: (id: string, userId: string) => apiDelete<{ ok: true }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/admins/${encodeURIComponent(userId)}`),
    setSubscription: (id: string, input: PlatformSubscriptionInput) => apiPut<{ ok: true }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/subscription`, input),
    recordPayment: (id: string, input: SubscriptionPaymentInput) =>
      apiPost<{ paymentId: string; paidUntil: string; reactivated: boolean }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/payments`, input),
    voidPayment: (id: string, paymentId: string, reason: string) =>
      apiPost<{ paidUntil: string }>(`/api/v1/platform/clinics/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/void`, { reason }),
    plans: () => apiGet<PlatformPlan[]>("/api/v1/platform/plans"),
    createPlan: (input: PlatformPlanInput) => apiPost<{ id: string }>("/api/v1/platform/plans", input),
    updatePlan: (id: string, input: Omit<PlatformPlanInput, "key">) => apiPut<{ id: string }>(`/api/v1/platform/plans/${encodeURIComponent(id)}`, input),
    activity: (params: { clinicId?: string; kind?: PlatformActivityKind; before?: string } = {}) => apiGet<PlatformActivityPage>("/api/v1/platform/activity", params),
    payments: (params: { clinicId?: string; before?: string } = {}) => apiGet<PlatformPaymentsPage>("/api/v1/platform/payments", params),
    paymentTotals: () => apiGet<PlatformPaymentTotals>("/api/v1/platform/payments/totals"),
    settings: () => apiGet<PlatformSettingsInfo>("/api/v1/platform/settings"),
  },
  portal: {
    summary: () => apiGet<PortalSummary>("/api/v1/portal/summary"),
    labReports: (params: { page?: number; pageSize?: number } = {}) => apiGet<PortalPage<PortalLabReport>>("/api/v1/portal/lab-reports", params),
    labReport: (id: string) => apiGet<PortalLabReportDetail>(`/api/v1/portal/lab-reports/${encodeURIComponent(id)}`),
    documents: (params: { page?: number; pageSize?: number } = {}) => apiGet<PortalPage<PortalDocument>>("/api/v1/portal/documents", params),
    download: downloadPortalFile,
    preview: async (id: string) => URL.createObjectURL((await fetchPortalFile(id, "inline")).blob),
    // Own appointments, booking, invoices and record (no patient id is ever sent).
    dashboard: () => apiGet<PortalDashboard>("/api/v1/portal/dashboard"),
    appointments: (params: { scope?: PortalAppointmentScope; page?: number; pageSize?: number } = {}) => apiGet<PortalPage<PortalAppointment>>("/api/v1/portal/appointments", params),
    appointment: (id: string) => apiGet<PortalAppointment>(`/api/v1/portal/appointments/${encodeURIComponent(id)}`),
    bookingOptions: () => apiGet<PortalBookingOptions>("/api/v1/portal/booking-options"),
    slots: (params: { doctorId: string; branchId: string; date: string }) => apiGet<{ date: string; slots: string[] }>("/api/v1/portal/slots", params),
    book: (input: PortalBookingRequest) => apiPost<PortalAppointment>("/api/v1/portal/appointments", input),
    cancel: (id: string) => apiPost<PortalAppointment>(`/api/v1/portal/appointments/${encodeURIComponent(id)}/cancel`),
    reschedule: (id: string, input: { date: string; time: string }) => apiPost<PortalAppointment>(`/api/v1/portal/appointments/${encodeURIComponent(id)}/reschedule`, input),
    invoices: (params: { page?: number; pageSize?: number } = {}) => apiGet<PortalPage<PortalInvoice>>("/api/v1/portal/invoices", params),
    record: () => apiGet<PortalClinicRecord>("/api/v1/portal/record"),
    clinic: () => apiGet<PortalClinicContact>("/api/v1/portal/clinic"),
    startPayment: (input: { purpose: "invoice" | "booking_fee"; id: string }) => apiPost<CheckoutOptions>("/api/v1/portal/payments/orders", input),
    verifyPayment: (input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
      apiPost<OnlinePaymentResult>("/api/v1/portal/payments/verify", input),
  },
  documents: {
    list: (params: ListDocumentsParams) => apiGet<DocumentPage>("/api/v1/documents", params),
    listForPatient: (patientId: string, params: ListDocumentsParams = {}) => apiGet<DocumentPage>(`/api/v1/patients/${encodeURIComponent(patientId)}/documents`, params),
    get: (id: string) => apiGet<LiveDocument>(`/api/v1/documents/${encodeURIComponent(id)}`),
    upload: uploadDocument,
    archive: (id: string, input: { reason: ArchiveReason; note?: string }) => apiPost<LiveDocument>(`/api/v1/documents/${encodeURIComponent(id)}/archive`, input),
    download: downloadDocument,
    preview: previewDocument,
  },
  labReports: {
    list: (params: ListLabReportsParams) => apiGet<LabReportPage>("/api/v1/lab-reports", params),
    get: (id: string) => apiGet<LiveLabReportDetail>(`/api/v1/lab-reports/${encodeURIComponent(id)}`),
    create: (input: CreateLabReportInput) => apiPost<{ id: string; readable: boolean }>("/api/v1/lab-reports", input),
    setValues: (id: string, input: SetLabValuesInput) => apiPatch<LiveLabReportDetail>(`/api/v1/lab-reports/${encodeURIComponent(id)}`, input),
    review: (id: string) => apiPost<LiveLabReportDetail>(`/api/v1/lab-reports/${encodeURIComponent(id)}/review`),
    share: (id: string) => apiPost<LiveLabReportDetail>(`/api/v1/lab-reports/${encodeURIComponent(id)}/share`),
    unshare: (id: string) => apiPost<LiveLabReportDetail>(`/api/v1/lab-reports/${encodeURIComponent(id)}/unshare`),
  },
  reports: {
    operational: (params: ReportParams) => apiGet<OperationalReport>("/api/v1/reports/operational", params),
    financial: (params: ReportParams) => apiGet<FinancialReport>("/api/v1/reports/financial", params),
    download: downloadReport,
  },
  branches: {
    list: () => apiGet<Branch[]>("/api/v1/branches"),
    create: (input: BranchInput) => apiPost<Branch>("/api/v1/branches", input),
    update: (id: string, patch: Partial<Omit<BranchInput, "code">>) => apiPatch<Branch>(`/api/v1/branches/${encodeURIComponent(id)}`, patch),
    setStatus: (id: string, status: Branch["status"]) => apiPatch<Branch>(`/api/v1/branches/${encodeURIComponent(id)}`, { status }),
  },
  departments: {
    list: () => apiGet<DepartmentPage>("/api/v1/departments"),
    create: (input: DepartmentInput) => apiPost<LiveDepartment>("/api/v1/departments", input),
    update: (id: string, patch: Partial<Omit<DepartmentInput, "branchId">>) => apiPatch<LiveDepartment>(`/api/v1/departments/${encodeURIComponent(id)}`, patch),
    setStatus: (id: string, status: LiveDepartment["status"]) => apiPatch<LiveDepartment>(`/api/v1/departments/${encodeURIComponent(id)}`, { status }),
  },
  clinicUsers: {
    list: () => apiGet<ClinicUsersPage>("/api/v1/clinic-users"),
    setRole: (membershipId: string, role: UserRole) => apiPatch<{ ok: true }>(`/api/v1/clinic-users/${encodeURIComponent(membershipId)}`, { role }),
    setPermissions: (membershipId: string, granted: string[], revoked: string[]) =>
      apiPatch<{ ok: true }>(`/api/v1/clinic-users/${encodeURIComponent(membershipId)}`, { granted, revoked }),
  },
  labTests: {
    list: () => apiGet<LabTestPage>("/api/v1/lab-tests"),
    create: (input: { name: string; category: LabTestCategory }) => apiPost<LiveLabTest>("/api/v1/lab-tests", input),
    update: (id: string, patch: { name?: string; category?: LabTestCategory } | { status: LiveLabTest["status"] }) =>
      apiPatch<LiveLabTest>(`/api/v1/lab-tests/${encodeURIComponent(id)}`, patch),
  },
  clinic: {
    get: () => apiGet<ClinicProfile>("/api/v1/clinic"),
    update: (patch: Partial<ClinicProfileInput>) => apiPatch<ClinicProfile>("/api/v1/clinic", patch),
    settings: () => apiGet<ClinicSettingsPage>("/api/v1/clinic/settings"),
    updateSettings: (patch: Partial<ClinicSettings>) => apiPatch<ClinicSettingsPage>("/api/v1/clinic/settings", patch),
  },
  auditEvents: (params: { area?: AuditArea; outcome?: "success" | "denied" | "failure"; search?: string; page?: number; pageSize?: number }) =>
    apiGet<AuditPage>("/api/v1/audit-events", params),
  expenses: {
    list: (params: { search?: string; category?: LiveExpenseCategory; branchId?: string; status?: "recorded" | "voided" | "all"; page?: number; pageSize?: number }) =>
      apiGet<ExpensePage>("/api/v1/expenses", params),
    create: (input: ExpenseInput) => apiPost<LiveExpense>("/api/v1/expenses", input),
    void: (id: string, reason: string) => apiPost<LiveExpense>(`/api/v1/expenses/${encodeURIComponent(id)}/void`, { reason }),
  },
  patients: {
    list: (params: ListPatientsParams) => apiGet<PagedResult<Patient>>("/api/v1/patients", params),
    get: (id: string) => apiGet<Patient>(`/api/v1/patients/${encodeURIComponent(id)}`),
    create: (input: CreatePatientInput) => apiPost<Patient>("/api/v1/patients", input),
    update: (id: string, patch: Partial<Patient>) =>
      apiPatch<Patient>(
        `/api/v1/patients/${encodeURIComponent(id)}`,
        Object.fromEntries(Object.entries(patch).filter(([k]) => (PATIENT_EDITABLE as readonly string[]).includes(k)))
      ),
    setStatus: (id: string, status: PatientStatus) => apiPatch<Patient>(`/api/v1/patients/${encodeURIComponent(id)}`, { status }),
    timeline: (id: string) => apiGet<TimelineEvent[]>(`/api/v1/patients/${encodeURIComponent(id)}/timeline`),
    // P6.4 patient portal linking codes (patient.portal_link).
    portalLink: (id: string) => apiGet<PortalLinkStatus>(`/api/v1/patients/${encodeURIComponent(id)}/portal-link`),
    issuePortalLinkCode: (id: string) => apiPost<PortalLinkCode>(`/api/v1/patients/${encodeURIComponent(id)}/portal-link`, { identityVerified: true }),
    revokePortalLinkCode: (id: string) => apiPost<{ revoked: boolean }>(`/api/v1/patients/${encodeURIComponent(id)}/portal-link/revoke`, {}),
    // P6.5 patient-reported onboarding answers (medical-record permission; read-only).
    patientReported: (id: string) => apiGet<PatientReportedView>(`/api/v1/patients/${encodeURIComponent(id)}/patient-reported`),
  },
  consultations: {
    list: (params: ListConsultationsParams) => apiGet<PagedResult<ConsultationWithNames>>("/api/v1/consultations", params),
    get: (id: string) => apiGet<ConsultationWithNames>(`/api/v1/consultations/${encodeURIComponent(id)}`),
    start: (appointmentId: string) => apiPost<ConsultationWithNames>("/api/v1/consultations", { appointmentId }),
    update: (id: string, patch: Partial<Consultation>) => apiPatch<ConsultationWithNames>(`/api/v1/consultations/${encodeURIComponent(id)}`, consultationPatch(patch)),
    complete: (id: string, patch: Partial<Consultation>) => apiPost<ConsultationWithNames>(`/api/v1/consultations/${encodeURIComponent(id)}/complete`, consultationPatch(patch)),
  },
  prescriptions: {
    list: (params: ListPrescriptionsParams) => apiGet<PagedResult<PrescriptionWithNames>>("/api/v1/prescriptions", params),
    get: (id: string) => apiGet<PrescriptionWithNames>(`/api/v1/prescriptions/${encodeURIComponent(id)}`),
    create: (input: CreateLivePrescriptionInput) => apiPost<PrescriptionWithNames>("/api/v1/prescriptions", input),
  },
  inventory: {
    list: (params: ListStockParams) => apiGet<PagedResult<StockRow>>("/api/v1/inventory", params),
    summary: (branchId?: string) => apiGet<LiveInventorySummary>("/api/v1/inventory/summary", { branchId }),
    detail: (branchId: string, medicineId: string) => apiGet<StockDetail>(`/api/v1/inventory/stock/${encodeURIComponent(branchId)}/${encodeURIComponent(medicineId)}`),
    receive: (input: ReceiveStockInput) => apiPost<StockDetail>("/api/v1/inventory/receipts", input),
    adjust: (itemId: string, quantityDelta: number, reason: string) =>
      apiPost<StockDetail>(`/api/v1/inventory/items/${encodeURIComponent(itemId)}/adjustments`, { quantityDelta, reason }),
    reverse: (movementId: string, reason?: string) => apiPost<StockDetail>(`/api/v1/inventory/movements/${encodeURIComponent(movementId)}/reverse`, { reason: reason || undefined }),
    setReorderLevel: (branchId: string, medicineId: string, reorderLevel: number) =>
      apiPut<StockDetail>(`/api/v1/inventory/stock/${encodeURIComponent(branchId)}/${encodeURIComponent(medicineId)}/reorder-level`, { reorderLevel }),
  },
  catalog: {
    search: (params: { search?: string; page?: number; pageSize?: number }) => apiGet<CatalogPage>("/api/v1/medicines", params),
    create: (input: CreateCatalogMedicineInput) => apiPost<CatalogMedicine>("/api/v1/medicines", input),
  },
  appointments: {
    list: (params: ListAppointmentsParams) => apiGet<PagedResult<AppointmentWithNames>>("/api/v1/appointments", params),
    get: (id: string) => apiGet<AppointmentWithNames>(`/api/v1/appointments/${encodeURIComponent(id)}`),
    today: (branchId?: string) => apiGet<AppointmentWithNames[]>("/api/v1/schedule/today", { branchId }),
    waitingRoom: (branchId?: string) => apiGet<AppointmentWithNames[]>("/api/v1/schedule/waiting-room", { branchId }),
    create: (input: CreateAppointmentInput) =>
      apiPost<AppointmentWithNames>("/api/v1/appointments", {
        patientId: input.patientId,
        doctorId: input.doctorId,
        branchId: input.branchId || undefined, // the server picks a valid branch when omitted
        date: input.date,
        time: input.time,
        type: input.type,
        reason: input.reason,
        notes: input.notes || undefined,
      }),
    checkIn: (id: string) => apiPost<AppointmentWithNames>(`/api/v1/appointments/${encodeURIComponent(id)}/check-in`),
    cancel: (id: string) => apiPost<AppointmentWithNames>(`/api/v1/appointments/${encodeURIComponent(id)}/cancel`),
    noShow: (id: string) => apiPost<AppointmentWithNames>(`/api/v1/appointments/${encodeURIComponent(id)}/no-show`),
    reschedule: (id: string, date: string, time: string) => apiPatch<AppointmentWithNames>(`/api/v1/appointments/${encodeURIComponent(id)}`, { date, time }),
  },
  onlinePayments: {
    refundsNeedingAttention: () => apiGet<{ items: RefundAttention[] }>("/api/v1/online-payments/refunds"),
    retryRefund: (id: string) => apiPost<{ refunded: boolean }>(`/api/v1/online-payments/${encodeURIComponent(id)}/refund`),
  },
  bookingRequests: {
    list: (branchId?: string) => apiGet<BookingRequestPage>("/api/v1/booking-requests", { branchId }),
    approve: (id: string) => apiPost<{ id: string; status: "confirmed"; decidedAt: string }>(`/api/v1/booking-requests/${encodeURIComponent(id)}/approve`),
    reject: (id: string, reason: string) =>
      apiPost<{ id: string; status: "rejected"; decidedAt: string; feeRefund?: "refunded" | "pending" | null }>(`/api/v1/booking-requests/${encodeURIComponent(id)}/reject`, { reason }),
  },
  doctors: {
    list: (params: ListDoctorsParams & { status?: "active" | "inactive" | "all" }) =>
      apiGet<PagedResult<Doctor> & { capabilities?: { canInviteDoctors: boolean; invitationsReady: boolean } }>("/api/v1/doctors", params),
    get: (id: string) => apiGet<Doctor>(`/api/v1/doctors/${encodeURIComponent(id)}`),
    slots: (id: string, date: string) => apiGet<string[]>(`/api/v1/doctors/${encodeURIComponent(id)}/slots`, { date }),
  },
  specialties: {
    list: () => apiGet<{ items: SpecialtyOption[] }>("/api/v1/specialties"),
    usage: () => apiGet<SpecialtyUsagePage>("/api/v1/specialties/usage"),
    create: (input: { name: string; description: string | null }) => apiPost<LiveSpecialty>("/api/v1/specialties", input),
    update: (id: string, patch: { name?: string; description?: string | null }) => apiPatch<LiveSpecialty>(`/api/v1/specialties/${encodeURIComponent(id)}`, patch),
  },
  staff: {
    list: (params: ListStaffParams) => apiGet<PagedResult<StaffMember> & { capabilities: StaffCapabilities }>("/api/v1/staff", params),
    setStatus: (id: string, status: StaffMember["status"]) => apiPatch<{ id: string; status: StaffMember["status"] }>(`/api/v1/staff/${encodeURIComponent(id)}`, { status }),
    setPhone: (id: string, phone: string) => apiPatch<{ id: string; phone: string }>(`/api/v1/staff/${encodeURIComponent(id)}`, { phone }),
  },
  billing: {
    invoices: (params: ListInvoicesParams) => apiGet<PagedResult<InvoiceWithNames>>("/api/v1/invoices", params),
    invoice: (id: string) => apiGet<InvoiceWithNames>(`/api/v1/invoices/${encodeURIComponent(id)}`),
    createForAppointment: (appointmentId: string) => apiPost<InvoiceWithNames>("/api/v1/invoices", { appointmentId }),
    createManual: (input: CreateManualInvoiceInput) =>
      apiPost<InvoiceWithNames>("/api/v1/invoices", {
        patientId: input.patientId,
        branchId: input.branchId || undefined, // the server defaults to the user's or the patient's branch
        items: input.items.map((i) => ({ description: i.description, category: i.category, quantity: i.quantity, unitPricePaise: toPaise(i.unitPrice) })),
        discountPaise: toPaise(input.discount ?? 0),
        taxRatePercent: input.taxRate ?? 0,
      }),
    recordPayment: (invoiceId: string, amount: number, method: PaymentMethod, reference?: string) =>
      apiPost<InvoiceWithNames>(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/payments`, { amountPaise: toPaise(amount), method, reference: reference || undefined }),
    voidInvoice: (invoiceId: string) => apiPost<InvoiceWithNames>(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/void`),
    refundPayment: (paymentId: string) => apiPost<InvoiceWithNames>(`/api/v1/payments/${encodeURIComponent(paymentId)}/refund`),
    payments: (params: ListPaymentsParams) => apiGet<PagedResult<Payment & { patientName: string }>>("/api/v1/payments", params),
    summary: () => apiGet<BillingSummary>("/api/v1/billing/summary"),
  },
  search: (q: string) => apiGet<GlobalSearchResults>("/api/v1/search", { q }),
  notifications: {
    list: (params: { cursor?: string; limit?: number; unread?: boolean }) =>
      apiGet<NotificationPage>("/api/v1/notifications", { cursor: params.cursor, limit: params.limit, unread: params.unread ? "true" : undefined }),
    unreadCount: () => apiGet<UnreadCount>("/api/v1/notifications/unread-count"),
    markRead: (id: string) => apiPost<{ read: true }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`),
    /** `before`: createdAt of the newest notification shown — anything newer stays unread. */
    markAllRead: (before: string) => apiPost<{ marked: number }>("/api/v1/notifications/read-all", { before }),
  },
  invitations: {
    list: (params: { status?: string; page?: number; pageSize?: number }) => apiGet<InvitationPage>("/api/v1/staff/invitations", params),
    create: (input: CreateInvitationInput) => apiPost<InvitationResult>("/api/v1/staff/invitations", input),
    resend: (id: string) => apiPost<InvitationResult>(`/api/v1/staff/invitations/${encodeURIComponent(id)}/resend`),
    revoke: (id: string) => apiPost<{ invitation: StaffInvitation }>(`/api/v1/staff/invitations/${encodeURIComponent(id)}/revoke`),
  },
  me: {
    invitations: () => apiGet<{ items: MyInvitation[] }>("/api/v1/me/invitations"),
    acceptInvitation: (id: string) => apiPost<{ clinicId: string }>(`/api/v1/me/invitations/${encodeURIComponent(id)}/accept`),
  },
};

/** Thrown by hooks for features whose database version isn't built yet (the UI hides them in live mode). */
export function notConnected(feature: string): never {
  throw new Error(`${feature} isn't connected to the clinic database yet.`);
}

// Typed calls to the clinic database API (/api/v1). Mirrors the signatures of
// the mock services in src/services so hooks can switch between them; this
// module imports nothing from the mock store.
import { ApiRequestError, apiGet, apiPatch, apiPost, apiPut, toQuery } from "@/lib/api-client";
import type { PagedResult } from "@/lib/async";
import type { AppointmentWithNames, CreateAppointmentInput, ListAppointmentsParams } from "@/services/appointments";
import type { BillingSummary, CreateManualInvoiceInput, InvoiceWithNames, ListInvoicesParams, ListPaymentsParams } from "@/services/billing";
import type { CreatePatientInput, ListPatientsParams } from "@/services/patients";
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
} from "@/lib/live-types";
import type { ReportExportKey } from "@/lib/reports";
import type { Branch, Consultation, Doctor, Patient, Payment, PatientStatus, PaymentMethod, StaffMember, TimelineEvent } from "@/types";

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

export const liveApi = {
  reports: {
    operational: (params: ReportParams) => apiGet<OperationalReport>("/api/v1/reports/operational", params),
    financial: (params: ReportParams) => apiGet<FinancialReport>("/api/v1/reports/financial", params),
    download: downloadReport,
  },
  branches: {
    list: () => apiGet<Branch[]>("/api/v1/branches"),
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
  doctors: {
    list: (params: ListDoctorsParams & { status?: "active" | "inactive" | "all" }) =>
      apiGet<PagedResult<Doctor> & { capabilities?: { canInviteDoctors: boolean; invitationsReady: boolean } }>("/api/v1/doctors", params),
    get: (id: string) => apiGet<Doctor>(`/api/v1/doctors/${encodeURIComponent(id)}`),
    slots: (id: string, date: string) => apiGet<string[]>(`/api/v1/doctors/${encodeURIComponent(id)}/slots`, { date }),
  },
  specialties: {
    list: () => apiGet<{ items: SpecialtyOption[] }>("/api/v1/specialties"),
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

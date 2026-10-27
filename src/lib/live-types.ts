// Response/request shapes of the P5 /api/v1 endpoints (notifications, staff
// invitations, specialties). Pure types shared by server modules and the
// browser client — no runtime code, no mock-store imports.

import type { ArchiveReason, DocumentCategoryKey, LabReportStatusKey, LabValue } from "@/lib/documents";
import type { UserRole } from "@/types";

export interface SpecialtyOption {
  id: string;
  name: string;
}

/** What the signed-in user may do on the staff directory (the server re-checks every action). */
export interface StaffCapabilities {
  canChangeStatus: boolean;
  canInvite: boolean;
  canViewInvitations: boolean;
  /** False until the staff-invitation database migration is applied (the UI then says "not set up yet"). */
  invitationsReady: boolean;
  /** Administrators, once migration 20261020000100 (app.set_staff_phone) is applied. */
  canEditPhone: boolean;
}

// --- Notifications -----------------------------------------------------------

export type NotificationTypeKey =
  | "appointment_booked"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "appointment_checked_in"
  | "stock_low"
  | "stock_out"
  | "staff_invitation_accepted"
  | "booking_requested";

/** One notification as shown to its reader. Text is rendered by the server from fixed templates. */
export interface LiveNotification {
  id: string;
  type: NotificationTypeKey;
  title: string;
  body: string;
  /** A same-origin app path; the destination enforces its own permissions. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationPage {
  items: LiveNotification[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
  /** True when there are more unread than `count` shows (99+). */
  capped: boolean;
}

// --- Staff invitations -------------------------------------------------------

export const INVITABLE_ROLES = ["DOCTOR", "CLINIC_MANAGER", "RECEPTIONIST", "NURSE"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type InvitationState = "pending" | "expired" | "accepted" | "revoked";
/** "unknown": a send was started but its outcome was never recorded (shown after 2 minutes). */
export type DeliveryState = "not_sent" | "sending" | "sent" | "failed" | "unknown";

export interface StaffInvitation {
  id: string;
  email: string;
  name: string;
  roleKey: InvitableRole;
  branch: { id: string; name: string };
  status: InvitationState;
  delivery: DeliveryState;
  deliveryError: string | null;
  sendAttempts: number;
  lastSentAt: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByName: string | null;
  doctor: { specialtyName: string; registrationNumber: string } | null;
  canResend: boolean;
  canRevoke: boolean;
  /** When a resend becomes possible (cooldown), if it isn't now. */
  resendAvailableAt: string | null;
}

export interface InvitationPage {
  items: StaffInvitation[];
  total: number;
  page: number;
  pageSize: number;
  /** Whether the signed-in user may create, resend and revoke (Administrators). */
  canManage: boolean;
  /** Administrators only: whether this server can send invitation email (null for view-only users). */
  emailConfigured: boolean | null;
}

export interface DoctorInvitationDetails {
  specialtyId: string;
  qualifications: string;
  registrationNumber: string;
  experienceYears: number;
  /** Rupees; the API stores paise. */
  consultationFee: number;
  onlineConsultation: boolean;
}

export interface CreateInvitationInput {
  email: string;
  name: string;
  roleKey: InvitableRole;
  branchId: string;
  /** International format, e.g. "+919876543210" (validated again on the server). */
  phone: string;
  doctor?: DoctorInvitationDetails;
}

export interface InvitationResult {
  invitation: StaffInvitation;
  /** The email attempt's outcome. "sent" means handed to the email provider, never "accepted". */
  delivery: { status: "sent" | "failed"; error?: string };
}

/** A pending invitation as its invitee sees it (before they belong to the clinic). */
export interface MyInvitation {
  id: string;
  clinicName: string;
  branchName: string;
  roleKey: InvitableRole;
  expiresAt: string;
  expired: boolean;
}

// --- Clinic reports (P6.1) -----------------------------------------------------
// Aggregates only: counts and amounts by day, branch, doctor and payment method.
// No patient names, numbers or clinical details. Amounts are integer paise.

export type ReportUnavailableReason = "not_permitted" | "no_reliable_timestamps";

export interface ReportScope {
  from: string;
  to: string;
  /** The branch the figures cover; null = every branch the user may see. */
  branchId: string | null;
  /** True when the user's membership is limited to one branch (the filter can't be changed). */
  branchLocked: boolean;
  /** Branches the user may filter by. */
  branches: { id: string; name: string }[];
  /** True when only the signed-in doctor's own appointments are counted. */
  ownAppointmentsOnly: boolean;
  canViewFinancial: boolean;
  canExport: boolean;
  generatedAt: string;
}

export interface AppointmentCounts {
  total: number;
  completed: number;
  /** SCHEDULED + CONFIRMED. */
  upcoming: number;
  /** CHECKED_IN + IN_CONSULTATION. */
  inProgress: number;
  cancelled: number;
  noShow: number;
}

export interface OperationalReport {
  scope: ReportScope;
  /** null when the user's role can't see appointments (with the reason in `unavailable`). */
  appointments: {
    totals: AppointmentCounts;
    byBranch: ({ branchId: string; branchName: string } & AppointmentCounts)[];
    daily: ({ date: string } & AppointmentCounts)[];
    monthly: ({ month: string } & AppointmentCounts)[];
  } | null;
  patients: {
    total: number;
    byBranch: { branchId: string; branchName: string; count: number }[];
    daily: { date: string; count: number }[];
    monthly: { month: string; count: number }[];
  } | null;
  workload: {
    doctors: ({ doctorId: string; doctorName: string; noShowRate: number | null; avgConsultationMinutes: number | null; durationSamples: number } & AppointmentCounts)[];
    /** Average consultation length, only from consultations with consistent start/finish times. */
    duration: { available: true; avgMinutes: number; samples: number; excluded: number } | { available: false; reason: ReportUnavailableReason; excluded: number };
  } | null;
  unavailable: { section: "appointments" | "patients" | "workload"; reason: ReportUnavailableReason }[];
}

export interface FinancialReport {
  scope: ReportScope;
  collections: {
    netPaise: number;
    refundedPaise: number;
    grossPaise: number;
    paymentCount: number;
    refundCount: number;
    daily: { date: string; netPaise: number; refundedPaise: number }[];
    byMethod: { method: PaymentMethodKey; netPaise: number; payments: number; refundedPaise: number; refunds: number }[];
    byBranch: { branchId: string; branchName: string; netPaise: number; refundedPaise: number }[];
  };
  billed: { invoicedPaise: number; invoiceCount: number; voidCount: number; voidPaise: number };
  outstanding: {
    asOf: string;
    totalPaise: number;
    invoiceCount: number;
    bands: { band: "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus"; invoiceCount: number; balancePaise: number }[];
  };
}

export type PaymentMethodKey = "cash" | "upi" | "card" | "bank_transfer" | "online";

// --- P6.2: patient documents and lab reports -----------------------------------


/** A document row the caller may see (RLS decided). Never carries the storage key or file bytes. */
export interface LiveDocument {
  id: string;
  patientId: string;
  patientName: string | null;
  patientNumber: string | null;
  branch: { id: string; name: string } | null;
  category: DocumentCategoryKey;
  clinical: boolean;
  title: string;
  filename: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  status: "AVAILABLE" | "ARCHIVED";
  uploadedAt: string | null;
  uploadedByName: string | null;
  labReportId: string | null;
  consultationId: string | null;
  archivedAt: string | null;
  archiveReason: ArchiveReason | null;
  canArchive: boolean;
}

export interface DocumentPage {
  items: LiveDocument[];
  total: number;
  page: number;
  pageSize: number;
  /** What the caller may upload (the database checks again). */
  canUploadClinical: boolean;
  canUploadAdministrative: boolean;
  /** Whether the caller can read clinical files at all (false = upload-only, e.g. receptionists). */
  canViewClinical: boolean;
  storageConfigured: boolean;
}

/** Returned after an upload. `readable` is false for upload-only callers, who can't open the file afterwards. */
export interface UploadResult {
  id: string;
  category: DocumentCategoryKey;
  labReportId: string | null;
  readable: boolean;
}

export interface LiveLabReport {
  id: string;
  patientId: string;
  patientName: string | null;
  patientNumber: string | null;
  branch: { id: string; name: string } | null;
  testType: string;
  title: string;
  status: LabReportStatusKey;
  resultDate: string | null;
  orderedBy: { id: string; name: string } | null;
  consultationId: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  sharedWithPatientAt: string | null;
  valueCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LabReportPage {
  items: LiveLabReport[];
  total: number;
  page: number;
  pageSize: number;
  canCreate: boolean;
  /** False for upload-only callers: they can add results but never read reports back. */
  canView: boolean;
}

export interface LiveLabReportDetail extends LiveLabReport {
  values: LabValue[];
  notes: string | null;
  attachments: LiveDocument[];
  actions: { canEditValues: boolean; canReview: boolean; canShare: boolean; canAttach: boolean };
}

// --- P6.3: patient portal (own reviewed, shared lab reports and their files) ------

/** A lab report as the patient sees it: no internal notes, no staff ids. */
export interface PortalLabReport {
  id: string;
  testType: string;
  title: string;
  resultDate: string | null;
  reviewedAt: string | null;
  sharedAt: string;
  branchName: string | null;
  orderedByName: string | null;
  fileCount: number;
}

export interface PortalDocument {
  id: string;
  labReportId: string;
  labReportTitle: string | null;
  title: string;
  filename: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  uploadedAt: string | null;
}

export interface PortalLabReportDetail extends PortalLabReport {
  values: LabValue[];
  files: PortalDocument[];
}

/** P6.4: whether a patient has a portal account linked (never which), and their usable code's times (never the code). */
export interface PortalLinkStatus {
  linked: boolean;
  activeCode: { issuedAt: string; expiresAt: string } | null;
}

/** A newly issued linking code: shown to the staff member once, never retrievable again. */
export interface PortalLinkCode {
  code: string;
  expiresAt: string;
}

export interface PortalSummary {
  clinicName: string;
  patient: { name: string; patientNumber: string } | null;
  reportCount: number;
  documentCount: number;
  latestReports: PortalLabReport[];
}

// --- Patient portal: own appointments, booking, invoices and dashboard ------------

/** How the portal groups an appointment's status. */
/** "pending_approval": the patient's own request awaiting reception; "rejected": reception declined it. */
export type PortalAppointmentStatus = "pending_approval" | "scheduled" | "confirmed" | "checked_in" | "in_consultation" | "completed" | "cancelled" | "no_show" | "rejected";

/** One of the patient's OWN appointments: no staff notes, no other patients. */
export interface PortalAppointment {
  id: string;
  /** Short human reference (first 8 characters of the id, upper-case). */
  reference: string;
  date: string;
  time: string;
  startsAt: string;
  durationMinutes: number;
  type: "in_person" | "online" | "follow_up" | "walk_in";
  status: PortalAppointmentStatus;
  reason: string;
  doctorId: string;
  doctorName: string | null;
  specialty: string | null;
  branchId: string;
  branchName: string | null;
  /** Server-decided: the patient may cancel / reschedule this one now. */
  canCancel: boolean;
  canReschedule: boolean;
  /** Only for a declined request: reception's reason, as written for the patient. */
  rejectionReason?: string | null;
  /** Doctor's consultation fee (rupees). */
  fee?: number;
  /** The booking fee was paid online (and not refunded). */
  feePaid?: boolean;
  /** The fee was paid online and refunded (declined or withdrawn). */
  feeRefunded?: boolean;
  /** Online payments are set up and this booking's fee can be paid now. */
  canPayFee?: boolean;
}

export type PortalAppointmentScope = "upcoming" | "past" | "cancelled" | "all";

export interface PortalBookingBranch {
  id: string;
  name: string;
  city: string;
  addressLine: string;
}

export interface PortalBookingDoctor {
  id: string;
  name: string;
  specialty: string | null;
  department: string | null;
  qualifications: string;
  experienceYears: number;
  consultationFee: number;
  /** The doctor's profile offers online (video) consultations. */
  offersOnline: boolean;
  branchIds: string[];
}

export interface PortalBookingOptions {
  clinicName: string;
  branches: PortalBookingBranch[];
  doctors: PortalBookingDoctor[];
  /** The booking window the server enforces (days ahead). */
  maxDaysAhead: number;
  /** The clinic's rules (the database re-checks them on every booking). */
  rules: { open: boolean; needsApproval: boolean; minNoticeMinutes: number; maxUpcoming: number; slotMinutes: number };
}

export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  dueDate: string | null;
  total: number;
  paid: number;
  balance: number;
  status: "pending" | "partially_paid" | "paid";
  branchName: string | null;
  appointmentDate: string | null;
  /** Online payments are set up and there's a balance to pay. */
  canPayOnline?: boolean;
}

export interface PortalDashboard {
  clinicName: string;
  patient: {
    name: string;
    patientNumber: string;
    dateOfBirth: string;
    gender: "male" | "female" | "other";
    phone: string;
    email: string | null;
    bloodGroup: string | null;
    branchName: string | null;
  } | null;
  upcoming: PortalAppointment[];
  recent: PortalAppointment[];
  invoices: { outstandingCount: number; outstandingBalance: number; latest: PortalInvoice[] };
  reportCount: number;
  documentCount: number;
}

/** The clinic record as staff entered it (read-only for the patient). */
export interface PortalClinicRecord {
  name: string;
  patientNumber: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other";
  phone: string;
  email: string | null;
  bloodGroup: string | null;
  addressLine: string | null;
  city: string | null;
  allergies: string[];
  chronicConditions: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  branchName: string | null;
}

// --- Clinic setup (branches, departments, specialties, clinic profile) -------

/** Branch fields staff can set (live). The code is generated from the name when left empty. */
export interface BranchInput {
  name: string;
  code?: string;
  city: string;
  address: string;
  phone: string;
  email?: string;
}

export interface LiveDepartment {
  id: string;
  name: string;
  description: string | null;
  /** null: clinic-wide. */
  branchId: string | null;
  branchName: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  status: "active" | "inactive";
  doctorCount: number;
}

export interface DepartmentPage {
  items: LiveDepartment[];
  canManage: boolean;
}

/** Someone holding a staff role in the clinic, as listed on Users & Roles. */
export interface LiveClinicUser {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  /** Doctors only. */
  specialtyName: string | null;
  departmentName: string | null;
  /** null: clinic-wide. */
  branchId: string | null;
  branchName: string | null;
  status: "active" | "inactive";
  joinedDate: string;
  /** Permission keys added to / removed from the role's defaults for this person (administrators only; else empty). */
  granted: string[];
  revoked: string[];
  canEditPermissions: boolean;
  canChangeRole: boolean;
}

export interface ClinicUsersPage {
  items: LiveClinicUser[];
  /** Whether the viewer may change roles and permissions (clinic-wide administrators). */
  canManage: boolean;
  /** Roles a person can be moved between on this page. */
  changeableRoles: UserRole[];
  /** Each staff role's default permission keys. */
  roleDefaults: Partial<Record<UserRole, string[]>>;
  permissions: { key: string; name: string; module: string; description: string | null }[];
}

export type LabTestCategory = "pathology" | "radiology" | "cardiology" | "other";

/** One test in the clinic's lab test master (what doctors order from a consultation). */
export interface LiveLabTest {
  id: string;
  name: string;
  category: LabTestCategory;
  status: "active" | "inactive";
}

export interface LabTestPage {
  items: LiveLabTest[];
  canManage: boolean;
}

export interface DepartmentInput {
  name: string;
  description?: string | null;
  branchId?: string | null;
  specialtyId?: string | null;
}

/** The shared specialty catalogue with this clinic's usage. */
export interface LiveSpecialty {
  id: string;
  name: string;
  description: string | null;
  doctorCount: number;
  departmentCount: number;
  /** This clinic's own specialty (editable by its administrators); false = the shared catalogue. */
  custom: boolean;
}

export interface SpecialtyUsagePage {
  items: LiveSpecialty[];
  /** Whether the viewer may add and rename the clinic's own specialties. */
  canManage: boolean;
}

export interface ClinicProfile {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  currency: string;
  status: "active" | "suspended" | "pending";
  canEdit: boolean;
  /** What the signed-in user may do on the clinic-admin screens (UI hints; the server re-checks). */
  can: { createBranch: boolean; updateBranch: boolean; manageDepartments: boolean };
  usage: { branches: number; activeBranches: number; staff: number; doctors: number; patients: number };
}

export type ClinicProfileInput = Pick<ClinicProfile, "name" | "email" | "phone" | "addressLine" | "city" | "state" | "pincode">;

// --- Clinic settings (Settings page) ------------------------------------------------

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Opening hours of one weekday (IST, "HH:MM"), or null when closed. */
export type DayHours = { open: string; close: string } | null;
export type WeeklyHours = Record<Weekday, DayHours>;

/** Clinic timings: when patients can be booked (staff may still book any time). */
export interface ClinicTimings {
  weeklyHours: WeeklyHours;
  /** One daily break, e.g. lunch ("HH:MM"), or both null. */
  breakStart: string | null;
  breakEnd: string | null;
  slotMinutes: 10 | 15 | 20 | 30 | 45 | 60;
}

/** Patient portal booking rules (enforced by the database's booking functions). */
export interface BookingRules {
  onlineBookingEnabled: boolean;
  /** true: a booking is a request reception approves; false: confirmed at once. */
  bookingNeedsApproval: boolean;
  bookingMinNoticeMinutes: number;
  bookingMaxDaysAhead: number;
  bookingMaxUpcoming: number;
  /** Patients may pay bills and booking fees online (when online payments are set up). */
  patientOnlinePayments: boolean;
}

export interface BillingSettings {
  /** Null: "<clinic code>-INV-". */
  invoicePrefix: string | null;
  gstin: string | null;
  /** Offered on new manual bills; staff can change it per bill. */
  defaultTaxPercent: number;
  /** Printed at the bottom of every bill. */
  invoiceFooter: string | null;
  /** Methods reception may record a payment with. */
  paymentMethods: ("cash" | "upi" | "card" | "bank_transfer" | "online")[];
}

export interface BrandingSettings {
  /** data:image/(png|jpeg|webp);base64,… */
  logoDataUrl: string | null;
  /** "#rrggbb" accent on bills and prescriptions. */
  brandColor: string | null;
  website: string | null;
  /** Clinic establishment / registration number. */
  registrationNumber: string | null;
}

export type ClinicSettings = ClinicTimings & BookingRules & BillingSettings & BrandingSettings;

export interface ClinicSettingsPage {
  clinic: { name: string; code: string };
  settings: ClinicSettings;
  /** The prefix used when invoicePrefix is null. */
  defaultInvoicePrefix: string;
  /** Clinic-wide administrators (clinic.settings.manage). */
  canEdit: boolean;
}

// --- Audit log -----------------------------------------------------------------

export interface AuditEntry {
  id: string;
  occurredAt: string;
  /** Who: a staff member's name, a system label, or "Former user". */
  actorName: string;
  /** Human summary, e.g. "Updated a branch". */
  summary: string;
  /** Raw action key, e.g. "branches.update". */
  action: string;
  area: AuditArea;
  outcome: "success" | "denied" | "failure";
  /** Column names that changed (never values). */
  changed: string[];
  reason: string | null;
}

export type AuditArea = "sign_in" | "access" | "patients" | "appointments" | "clinical" | "billing" | "inventory" | "staff" | "setup" | "other";

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Expenses ------------------------------------------------------------------

export type LiveExpenseCategory = "rent" | "salary" | "utilities" | "equipment" | "medicine_purchase" | "lab_expense" | "marketing" | "maintenance" | "other";

export interface LiveExpense {
  id: string;
  branchId: string;
  branchName: string;
  category: LiveExpenseCategory;
  description: string;
  /** Rupees. */
  amount: number;
  date: string;
  paidTo: string | null;
  reference: string | null;
  status: "recorded" | "voided";
  voidReason: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface ExpensePage {
  items: LiveExpense[];
  total: number;
  page: number;
  pageSize: number;
  /** Rupees: recorded (not voided) expenses in the current IST month, in the user's branch scope. */
  monthTotal: number;
  canManage: boolean;
}

export interface ExpenseInput {
  branchId: string;
  category: LiveExpenseCategory;
  description: string;
  /** Rupees (up to 2 decimals). */
  amount: number;
  date: string;
  paidTo?: string;
  reference?: string;
}

// --- Reception approval of patient bookings ------------------------------------

/** A patient's self-booked request awaiting reception (staff view). */
export interface BookingRequest {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber: string | null;
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  branchId: string;
  branchName: string;
  date: string;
  time: string;
  startsAt: string;
  type: "in_person" | "online";
  reason: string;
  /** When the patient last submitted or moved the request. */
  requestedAt: string;
  /** The patient filled in the pre-visit questionnaire for it. */
  hasSymptomReport: boolean;
  /** The requested time has passed: it can only be declined. */
  expired: boolean;
  /** Advance fee paid online (rupees), or null. Refunded automatically if declined. */
  feePaid: number | null;
}

export interface BookingRequestPage {
  items: BookingRequest[];
  total: number;
  canReview: boolean;
}

/** The patient's clinic, as shown on its public contact card. */
export interface PortalClinicContact {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
}

// --- Public website (signed out) -------------------------------------------------

export interface PublicDirectoryDoctor {
  id: string;
  clinicId: string;
  name: string;
  specialty: string;
  department: string | null;
  qualifications: string;
  experienceYears: number;
  /** Rupees. */
  consultationFee: number;
  onlineConsultation: boolean;
  bio: string | null;
  branchIds: string[];
}

export interface PublicDirectoryBranch {
  id: string;
  clinicId: string;
  name: string;
  city: string;
  address: string;
  phone: string;
}

export interface PublicDirectoryClinic {
  id: string;
  name: string;
  city: string;
  phone: string;
  /** The clinic's opening hours (Settings → Clinic timings); absent before clinic settings existed. */
  hours?: WeeklyHours | null;
  /** Takes online bookings, and whether reception approves them. */
  onlineBooking?: boolean;
  needsApproval?: boolean;
}

export interface PublicDirectory {
  clinics: PublicDirectoryClinic[];
  branches: PublicDirectoryBranch[];
  doctors: PublicDirectoryDoctor[];
}

// --- Online payments (Razorpay) ------------------------------------------------

/** What the browser needs to open Razorpay Checkout (no secrets). */
export interface CheckoutOptions {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; email: string };
  testMode: boolean;
}

export interface OnlinePaymentResult {
  /** "refunded": the money arrived for a booking that's no longer open and was sent back. */
  status: "paid" | "refunded";
}

/** A refund that couldn't be completed automatically (staff retry). */
export interface RefundAttention {
  id: string;
  amount: number;
  purpose: "booking_fee" | "invoice";
  reason: string | null;
  requestedAt: string | null;
  patientName: string;
  patientNumber: string;
}

// --- Platform (Sehat Setu super admin) -------------------------------------------------

export interface PlatformClinic {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  status: "active" | "suspended" | "pending";
  createdAt: string;
  branches: number;
  staff: number;
  doctors: number;
  patients: number;
  appointmentsThisMonth: number;
  upcomingAppointments: number;
  /** Rupees received this month (succeeded payments). */
  revenueThisMonth: number;
  lastActivityAt: string | null;
  /** "invited": hasn't signed in yet. */
  admins: { userId: string; name: string; email: string; status: "active" | "invited" | "disabled" }[];
  /** What the clinic pays Sehat Setu; null for a clinic not on any plan (no limits). */
  subscription: PlatformSubscription | null;
  /** Rupees the clinic paid Sehat Setu this month. */
  subscriptionCollectedThisMonth: number;
}

export type BillingCycle = "monthly" | "yearly";
/** trial: free trial still running; due_soon: paid-until within 7 days; overdue: paid-until has passed. */
export type SubscriptionState = "trial" | "active" | "due_soon" | "overdue";

export interface PlatformSubscription {
  planId: string;
  planKey: string;
  planName: string;
  billingCycle: BillingCycle;
  /** Rupees per billing cycle (agreed with the clinic). */
  price: number;
  /** yyyy-MM-dd, inclusive. */
  paidUntil: string;
  state: SubscriptionState;
  /** Days from today to paid-until (negative once it has passed). */
  daysLeft: number;
  autoSuspend: boolean;
  graceDays: number;
  suspendedForNonPayment: boolean;
  notes: string | null;
  /** null: unlimited. */
  limits: { branches: number | null; doctors: number | null; staff: number | null };
}

export interface PlatformOverview {
  clinics: PlatformClinic[];
  totals: {
    clinics: number;
    activeClinics: number;
    doctors: number;
    staff: number;
    patients: number;
    appointmentsThisMonth: number;
    revenueThisMonth: number;
    /** Monthly recurring revenue: paying clinics' prices as a per-month amount (rupees). */
    mrr: number;
    subscriptionCollectedThisMonth: number;
    overdue: number;
    dueSoon: number;
  };
  /** Clinics suspended just now by auto-suspend (overdue past their grace days). */
  autoSuspended: number;
}

export interface PlatformPlan {
  id: string;
  key: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxBranches: number | null;
  maxDoctors: number | null;
  maxStaff: number | null;
  isActive: boolean;
  /** Clinics on this plan. */
  clinics: number;
}

export interface PlatformPlanInput {
  key?: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxBranches: number | null;
  maxDoctors: number | null;
  maxStaff: number | null;
  isActive: boolean;
}

export interface PlatformSubscriptionInput {
  planId: string;
  billingCycle: BillingCycle;
  price: number;
  paidUntil: string;
  autoSuspend: boolean;
  graceDays: number;
  notes: string;
}

export type SubscriptionPaymentMethod = "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";

export interface SubscriptionPaymentInput {
  amount: number;
  method: SubscriptionPaymentMethod;
  reference: string;
  paidOn: string;
  months: number;
  notes: string;
}

export interface SubscriptionPayment {
  id: string;
  amount: number;
  method: SubscriptionPaymentMethod;
  reference: string | null;
  paidOn: string;
  months: number;
  periodFrom: string;
  periodTo: string;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/** A payment in the all-clinics ledger (Payments page). */
export interface PlatformLedgerPayment extends SubscriptionPayment {
  clinicId: string;
  clinicName: string;
  clinicCode: string;
}

export interface PlatformPaymentsPage {
  payments: PlatformLedgerPayment[];
  /** Pass as `before` for the next (older) page; null when there's no more. */
  nextBefore: string | null;
}

/** Money received from clinics per month (India's calendar), the last 12 months, oldest first. */
export interface PlatformPaymentTotals {
  months: { month: string; amount: number; payments: number }[];
}

export interface PlatformSettingsInfo {
  /** Everyone with super admin access. */
  admins: { userId: string; name: string; email: string; status: "active" | "invited" | "disabled"; signedIn: boolean; since: string; isYou: boolean }[];
  /** The server can email invitations (SUPABASE_SECRET_KEY set). */
  emailConfigured: boolean;
}

export interface PlatformClinicDetail {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  status: "active" | "suspended" | "pending";
  createdAt: string;
  subscription: PlatformSubscription | null;
  counts: { branches: number; doctors: number; staff: number; pendingInvitations: number; patients: number; portalPatients: number };
  branches: { id: string; code: string; name: string; city: string; phone: string; isHeadOffice: boolean; status: "active" | "inactive" }[];
  people: {
    userId: string;
    name: string;
    email: string;
    /** invited: hasn't signed in yet. */
    accountStatus: "active" | "invited" | "disabled";
    status: "active" | "inactive";
    roles: string[];
    isAdmin: boolean;
    branch: string | null;
    specialty: string | null;
    since: string;
  }[];
  /** The last 6 months, oldest first; collected is rupees. */
  usage: { month: string; appointments: number; newPatients: number; collected: number }[];
  payments: SubscriptionPayment[];
}

export interface PlatformClinicProfileInput {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
}

export type PlatformActivityKind = "all" | "platform" | "problems";

export interface PlatformActivityEvent {
  id: string;
  occurredAt: string;
  action: string;
  outcome: "success" | "denied" | "failure";
  reason: string | null;
  targetType: string | null;
  clinicId: string | null;
  clinicName: string | null;
  clinicCode: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PlatformActivityPage {
  events: PlatformActivityEvent[];
  /** Pass as `before` for the next (older) page; null when there's no more. */
  nextBefore: string | null;
}

export interface PlatformClinicInput {
  code: string;
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  branchName: string;
  adminName: string;
  adminEmail: string;
}

export interface PlatformClinicCreated {
  clinicId: string;
  adminEmail: string;
  /** false: an existing account was made the clinic's administrator. */
  adminIsNew: boolean;
  invitationSent: boolean;
  invitationProblem: string | null;
}

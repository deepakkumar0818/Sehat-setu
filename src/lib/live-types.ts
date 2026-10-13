// Response/request shapes of the P5 /api/v1 endpoints (notifications, staff
// invitations, specialties). Pure types shared by server modules and the
// browser client — no runtime code, no mock-store imports.

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
  | "staff_invitation_accepted";

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

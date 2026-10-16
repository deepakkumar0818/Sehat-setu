// Sehat Setu — core domain types.
// This is the single source of truth for entity shapes used by mock data,
// services, hooks, and UI. Swapping the mock service layer for a real API
// later should not require changing these types.

export type UserRole =
  | "super_admin"
  | "clinic_owner"
  | "clinic_admin"
  | "branch_manager"
  | "doctor"
  | "receptionist"
  | "nurse"
  | "pharmacist"
  | "lab_staff"
  | "billing_staff"
  | "accountant"
  | "patient";

export type Gender = "male" | "female" | "other";

export interface Branch {
  id: string;
  /** The tenant this branch belongs to. See {@link Clinic}. */
  clinicId: string;
  name: string;
  /** Short branch code, e.g. "CHD-001". */
  code?: string;
  city: string;
  address: string;
  phone: string;
  email?: string;
  workingHours?: string;
  timezone?: string;
  isHeadOffice: boolean;
  status: "active" | "inactive";
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarColor: string;
  /** The tenant (clinic) this session belongs to. Absent only for platform-level super_admin. */
  clinicId?: string;
  branchId?: string;
  departmentId?: string;
  doctorId?: string;
  patientId?: string;
  staffId?: string;
  /** Row-level role reference for the granular permission system — see {@link Role}. Falls back to ROLE_PERMISSION_DEFAULTS[role] when absent (e.g. legacy demo accounts). */
  roleId?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Multi-tenancy: Platform -> Clinic -> Branch -> Department / Specialty
// ---------------------------------------------------------------------------

export type ClinicType =
  | "private_clinic"
  | "multi_specialty"
  | "hospital"
  | "diagnostic_center"
  | "dental_clinic"
  | "skin_clinic"
  | "eye_clinic"
  | "physiotherapy_center"
  | "mental_health_clinic"
  | "other";

export type ClinicStatus = "active" | "suspended" | "pending";

export interface ClinicSettings {
  currency: string;
  appointmentDurationMinutes: number;
  workingDays: DoctorAvailabilitySlot["day"][];
  onlineConsultationEnabled: boolean;
  smsNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
}

export interface Clinic {
  id: string;
  name: string;
  type: ClinicType;
  email: string;
  phone: string;
  website?: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  status: ClinicStatus;
  /** StaffMember.id (role clinic_owner) who owns this tenant. */
  ownerId: string;
  createdAt: string;
  settings: ClinicSettings;
}

export interface Specialty {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon component name, resolved by the UI's icon map. */
  icon?: string;
  services: string[];
  status: "active" | "inactive";
}

/** Join row: which specialties a given clinic has enabled. */
export interface ClinicSpecialty {
  clinicId: string;
  specialtyId: string;
}

export interface Department {
  id: string;
  clinicId: string;
  branchId: string;
  name: string;
  specialtyId?: string;
  description?: string;
  /** A Doctor.id or StaffMember.id acting as department head. */
  headUserId?: string;
  status: "active" | "inactive";
}

// ---------------------------------------------------------------------------
// RBAC: Role & Permission
// ---------------------------------------------------------------------------

export type PermissionModule =
  | "platform"
  | "clinic"
  | "branch"
  | "user"
  | "role"
  | "patient"
  | "appointment"
  | "prescription"
  | "medical_record"
  | "billing"
  | "reports"
  | "pharmacy"
  | "lab"
  | "documents"
  | "settings"
  | "online_consultation";

export interface Permission {
  /** Dot-delimited permission key, e.g. "patient.view". Doubles as the row id. */
  key: string;
  name: string;
  module: PermissionModule;
  description: string;
}

export type RoleScope = "platform" | "clinic";

export interface Role {
  id: string;
  name: string;
  description: string;
  scope: RoleScope;
  /** Present for clinic-scoped custom roles; absent for platform/system roles. */
  clinicId?: string;
  /** True for the 12 built-in roles seeded per clinic — protected from destructive edits in the UI. */
  isSystemRole: boolean;
  /** The underlying UserRole this system role corresponds to, if any (system roles only). */
  baseRole?: UserRole;
  permissionKeys: string[];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type DoctorStatus = "active" | "on_leave" | "inactive";

export interface DoctorAvailabilitySlot {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface Doctor {
  id: string;
  clinicId: string;
  name: string;
  /** Not stored in the clinic database; present only in demo data. */
  gender?: Gender;
  qualifications: string;
  /** Free-text specialty label, kept for backward-compatible display. Prefer specialtyId for new code. */
  specialization: string;
  specialtyId?: string;
  departmentId?: string;
  registrationNumber?: string;
  experienceYears: number;
  consultationFee: number;
  branchId: string;
  phone: string;
  email: string;
  status: DoctorStatus;
  onlineConsultation: boolean;
  /** null when no rating exists (the clinic database stores none). */
  rating: number | null;
  avatarColor: string;
  bio: string;
  availability: DoctorAvailabilitySlot[];
  joinedDate: string;
}

export type StaffRole = Exclude<UserRole, "patient" | "doctor">;

export interface StaffMember {
  id: string;
  clinicId: string;
  name: string;
  role: StaffRole;
  branchId: string;
  departmentId?: string;
  phone: string;
  email: string;
  status: "active" | "inactive";
  lastActiveAt: string;
  joinedDate: string;
  avatarColor: string;
  /** Only set when the account holder chose their own password (e.g. clinic onboarding); everyone else uses the shared demo password. */
  password?: string;
  /** Live data only: whether the signed-in user may activate/deactivate this membership (never their own). */
  canChangeStatus?: boolean;
  /** Live data only: whether the signed-in user may edit this person's phone number (Administrators). */
  canEditPhone?: boolean;
}

export type PatientStatus = "active" | "inactive" | "archived";

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

/**
 * A patient is a platform-level identity, not owned by a single clinic — in
 * principle they can have appointments across multiple clinics. This
 * prototype keeps one registered `branchId`/clinic per patient (the branch
 * they signed up at) as a practical simplification; a real system would
 * model patient<->clinic as a many-to-many relationship derived from their
 * appointment history instead.
 */
export interface Patient {
  id: string;
  /** Human-facing number (e.g. "AAR-P-0001"); database records only. */
  patientNumber?: string;
  name: string;
  age: number;
  dob: string;
  gender: Gender;
  phone: string;
  email: string;
  bloodGroup: string;
  address: string;
  city: string;
  branchId: string;
  status: PatientStatus;
  allergies: string[];
  chronicConditions: string[];
  registeredDate: string;
  lastVisit?: string;
  nextAppointmentId?: string;
  avatarColor: string;
  emergencyContact: EmergencyContact;
  /** Only set for self-registered patients (see services/patients.ts#registerPatient); everyone else uses the shared demo password. */
  password?: string;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export type AppointmentType = "in_person" | "online" | "follow_up" | "walk_in";

export type AppointmentStatus =
  | "upcoming"
  | "waiting"
  | "in_consultation"
  | "completed"
  | "cancelled"
  | "no_show"
  /** A patient's own booking awaiting reception's approval (live mode). */
  | "pending_approval"
  /** A patient's request reception declined (live mode). */
  | "rejected";

export type PaymentStatus = "paid" | "pending" | "partial";

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  branchId: string;
  date: string; // ISO date, yyyy-MM-dd
  time: string; // "10:30"
  durationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  reason: string;
  notes?: string;
  paymentStatus: PaymentStatus;
  fee: number;
  createdAt: string;
  checkedInAt?: string;
  waitStartedAt?: string;
  consultationId?: string;
  invoiceId?: string;
}

// ---------------------------------------------------------------------------
// Clinical
// ---------------------------------------------------------------------------

export interface Vitals {
  temperatureF?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  heartRate?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
  bmi?: number;
}

export type ConsultationStatus = "in_progress" | "completed";

export interface Consultation {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  branchId: string;
  date: string;
  chiefComplaint: string;
  symptoms: string[];
  history?: string;
  allergiesNoted: string[];
  vitals: Vitals;
  examination?: string;
  diagnosis: string[];
  clinicalNotes: string;
  treatmentPlan?: string;
  labTestsOrdered: string[];
  followUpDate?: string;
  prescriptionId?: string;
  status: ConsultationStatus;
}

export interface PrescriptionItem {
  medicineName: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string;
  instructions?: string;
}

export type PrescriptionStatus = "active" | "completed" | "cancelled";

export interface Prescription {
  id: string;
  patientId: string;
  doctorId: string;
  consultationId?: string;
  date: string;
  items: PrescriptionItem[];
  notes?: string;
  status: PrescriptionStatus;
  aiReviewFlags: string[];
}

export type LabReportType =
  | "CBC"
  | "LFT"
  | "KFT"
  | "Lipid Profile"
  | "X-Ray"
  | "MRI"
  | "CT Scan"
  | "Ultrasound"
  | "ECG"
  | "Other";

export interface LabReportValue {
  parameter: string;
  value: string;
  unit: string;
  range: string;
  flag: "low" | "high" | "normal";
}

export type LabReportStatus = "pending" | "available";

export interface LabReport {
  id: string;
  patientId: string;
  doctorId?: string;
  consultationId?: string;
  type: LabReportType;
  title: string;
  date: string;
  status: LabReportStatus;
  values: LabReportValue[];
  notes?: string;
  sharedWithPatient: boolean;
}

export type DocumentCategory =
  | "prescription"
  | "lab_report"
  | "invoice"
  | "id_proof"
  | "referral"
  | "other";

export interface PatientDocument {
  id: string;
  patientId: string;
  category: DocumentCategory;
  title: string;
  date: string;
  refId?: string;
  sizeKb: number;
}

// ---------------------------------------------------------------------------
// Pharmacy / Inventory
// ---------------------------------------------------------------------------

export type MedicineStatus =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "expiring_soon"
  | "expired";

export interface Medicine {
  id: string;
  name: string;
  category: string;
  batchNumber: string;
  stock: number;
  unit: string;
  reorderLevel: number;
  expiryDate: string;
  supplier: string;
  pricePerUnit: number;
}

export interface StockMovement {
  id: string;
  medicineId: string;
  type: "purchase" | "sale" | "adjustment";
  quantity: number;
  date: string;
  reference?: string;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type InvoiceCategory = "consultation" | "medicine" | "lab_test" | "procedure" | "other";

export interface InvoiceLineItem {
  description: string;
  category: InvoiceCategory;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** "refunded" exists only in demo data; the clinic database marks cancelled invoices "void". */
export type InvoiceStatus = "paid" | "partial" | "pending" | "refunded" | "void";
export type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "online";

export interface Invoice {
  id: string;
  patientId: string;
  branchId: string;
  appointmentId?: string;
  date: string;
  items: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  paymentMethod?: PaymentMethod;
  /** Human-facing number from the clinic database (demo data uses `id`). */
  invoiceNumber?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  patientId: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  status: "success" | "pending" | "failed" | "refunded";
  invoiceNumber?: string;
  reference?: string;
  /** Exact time received (clinic database only). */
  paidAt?: string;
}

export type ExpenseCategory =
  | "rent"
  | "salary"
  | "utilities"
  | "equipment"
  | "medicine_purchase"
  | "lab_expense"
  | "marketing"
  | "maintenance"
  | "other";

export interface Expense {
  id: string;
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  paidTo?: string;
}

// ---------------------------------------------------------------------------
// Communication / system
// ---------------------------------------------------------------------------

export type NotificationType =
  | "appointment_reminder"
  | "report_available"
  | "payment_received"
  | "prescription_created"
  | "low_stock"
  | "expiry_warning"
  | "ai_insight"
  | "system";

export interface AppNotification {
  id: string;
  audienceRole?: UserRole;
  patientId?: string;
  doctorId?: string;
  type: NotificationType;
  title: string;
  message: string;
  date: string;
  read: boolean;
  link?: string;
}

export interface AuditLogEntry {
  id: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId?: string;
  date: string;
  branchId?: string;
}

export interface TimelineEvent {
  id: string;
  patientId: string;
  date: string;
  type: "consultation" | "report" | "prescription" | "appointment" | "invoice";
  title: string;
  subtitle?: string;
  refId: string;
  href: string;
}

// ---------------------------------------------------------------------------
// SaaS subscription (billing for the platform itself)
// ---------------------------------------------------------------------------

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceMonthly: number;
  features: string[];
  branchLimit: number;
  userLimit: number;
}

export interface SubscriptionInvoice {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  planName: string;
}

// ---------------------------------------------------------------------------
// The aggregate mock database shape
// ---------------------------------------------------------------------------

export interface SehatSetuDatabase {
  seedVersion: number;
  generatedAt: string;
  clinics: Clinic[];
  specialties: Specialty[];
  clinicSpecialties: ClinicSpecialty[];
  departments: Department[];
  roles: Role[];
  branches: Branch[];
  doctors: Doctor[];
  staff: StaffMember[];
  patients: Patient[];
  appointments: Appointment[];
  consultations: Consultation[];
  prescriptions: Prescription[];
  labReports: LabReport[];
  documents: PatientDocument[];
  medicines: Medicine[];
  stockMovements: StockMovement[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  notifications: AppNotification[];
  auditLog: AuditLogEntry[];
}

export interface DemoAccount {
  email: string;
  password: string;
  role: UserRole;
  label: string;
  description: string;
}

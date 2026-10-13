// The full permission catalog for Sehat Setu's RBAC system, plus the default
// permission set for each of the 12 built-in (system) roles.
//
// This is the single source of truth: UI permission-matrix screens render
// from PERMISSION_CATALOG, and every system Role seeded into a clinic gets
// its keys from ROLE_PERMISSION_DEFAULTS. Custom clinic roles are built by
// picking a subset of PERMISSION_CATALOG keys at runtime (see services/roles.ts).
import type { Permission, PermissionModule, UserRole } from "@/types";

export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  platform: "Platform",
  clinic: "Clinic",
  branch: "Branches",
  user: "Users",
  role: "Roles",
  patient: "Patients",
  appointment: "Appointments",
  prescription: "Prescriptions",
  medical_record: "Medical Records",
  billing: "Billing",
  reports: "Reports",
  pharmacy: "Pharmacy",
  lab: "Lab",
  settings: "Settings",
  online_consultation: "Online Consultation",
};

export const PERMISSION_CATALOG: Permission[] = [
  // Platform (super_admin only)
  { key: "platform.clinic.manage", name: "Manage clinics", module: "platform", description: "Create, suspend, and manage every clinic tenant on the platform." },
  { key: "platform.settings.manage", name: "Manage platform settings", module: "platform", description: "Configure platform-wide system settings." },
  { key: "platform.specialty.manage", name: "Manage global specialties", module: "platform", description: "Maintain the platform-wide specialty catalog." },
  { key: "platform.user.manage", name: "Manage platform users", module: "platform", description: "Manage platform-level (super admin) users." },
  { key: "platform.analytics.view", name: "View platform analytics", module: "platform", description: "See usage and performance across every clinic." },
  { key: "platform.subscription.manage", name: "Manage subscriptions", module: "platform", description: "Manage clinic subscription plans and billing." },

  // Clinic
  { key: "clinic.view", name: "View clinic", module: "clinic", description: "View this clinic's profile and settings." },
  { key: "clinic.update", name: "Update clinic", module: "clinic", description: "Edit this clinic's profile." },
  { key: "clinic.settings.manage", name: "Manage clinic settings", module: "clinic", description: "Configure appointment, payment, and notification settings." },
  { key: "clinic.delete", name: "Delete clinic", module: "clinic", description: "Permanently delete this clinic. Owner only." },

  // Branch
  { key: "branch.create", name: "Create branch", module: "branch", description: "Add a new branch location." },
  { key: "branch.view", name: "View branches", module: "branch", description: "View branch locations." },
  { key: "branch.update", name: "Update branch", module: "branch", description: "Edit a branch's details." },
  { key: "branch.delete", name: "Delete branch", module: "branch", description: "Remove a branch location." },

  // Users & roles
  { key: "user.create", name: "Add staff/doctors", module: "user", description: "Create new staff and doctor accounts." },
  { key: "user.view", name: "View users", module: "user", description: "View the clinic's staff and doctor directory." },
  { key: "user.update", name: "Update users", module: "user", description: "Edit staff and doctor details." },
  { key: "user.disable", name: "Disable users", module: "user", description: "Deactivate a staff or doctor account." },
  { key: "role.manage", name: "Manage roles & permissions", module: "role", description: "Create custom roles and edit permission assignments." },
  { key: "doctor.manage", name: "Manage doctors", module: "user", description: "Add, edit, and manage doctor profiles." },
  { key: "doctor.view", name: "View doctors", module: "user", description: "View doctor profiles." },
  { key: "staff.manage", name: "Manage staff", module: "user", description: "Add, edit, and manage non-doctor staff." },
  { key: "staff.view", name: "View staff", module: "user", description: "View staff profiles." },

  // Patients
  { key: "patient.view", name: "View patients", module: "patient", description: "View patient profiles." },
  { key: "patient.create", name: "Create patients", module: "patient", description: "Register a new patient." },
  { key: "patient.update", name: "Update patients", module: "patient", description: "Edit patient details." },
  { key: "patient.update_basic_info", name: "Update basic patient info", module: "patient", description: "Edit a patient's contact/basic details only." },
  { key: "patient.basic_info.view", name: "View basic patient info", module: "patient", description: "View a patient's name and contact details without full medical history." },
  { key: "assigned_patients.view", name: "View assigned patients", module: "patient", description: "View only patients assigned to you." },
  { key: "assigned_patient.view", name: "View assigned patient", module: "patient", description: "View a patient linked to your lab order." },

  // Appointments
  { key: "appointment.view", name: "View appointments", module: "appointment", description: "View the appointment schedule." },
  { key: "appointment.create", name: "Create appointments", module: "appointment", description: "Book new appointments." },
  { key: "appointment.update", name: "Update appointments", module: "appointment", description: "Reschedule or edit appointments." },
  { key: "appointment.cancel", name: "Cancel appointments", module: "appointment", description: "Cancel an appointment." },
  { key: "own_appointments.view", name: "View own appointments", module: "appointment", description: "View your own appointment schedule." },
  { key: "own_appointments.manage", name: "Manage own appointments", module: "appointment", description: "Update your own appointments." },
  { key: "checkin.manage", name: "Manage check-in", module: "appointment", description: "Check patients in and manage the waiting room." },
  { key: "online_consultation.manage", name: "Manage online consultations", module: "online_consultation", description: "Start and manage online video consultations." },

  // Clinical
  { key: "profile.view", name: "View own profile", module: "user", description: "View your own staff/doctor profile." },
  { key: "profile.update", name: "Update own profile", module: "user", description: "Edit your own staff/doctor profile." },
  { key: "prescription.view", name: "View prescriptions", module: "prescription", description: "View prescriptions." },
  { key: "prescription.create", name: "Create prescriptions", module: "prescription", description: "Write a new prescription." },
  { key: "prescription.update", name: "Update prescriptions", module: "prescription", description: "Edit a prescription." },
  { key: "prescription.manage", name: "Manage prescriptions", module: "prescription", description: "Full control over prescriptions." },
  { key: "medical_record.view", name: "View medical records", module: "medical_record", description: "View patient medical records." },
  { key: "medical_record.manage", name: "Manage medical records", module: "medical_record", description: "Edit patient medical records." },
  { key: "patient.medical_record.view", name: "View patient medical record", module: "medical_record", description: "View a patient's medical record." },
  { key: "patient.medical_record.update", name: "Update patient medical record", module: "medical_record", description: "Edit a patient's medical record." },
  { key: "medical_notes.create", name: "Create medical notes", module: "medical_record", description: "Add consultation notes." },
  { key: "medical_notes.update", name: "Update medical notes", module: "medical_record", description: "Edit consultation notes." },
  { key: "clinical_notes.create", name: "Create clinical notes", module: "medical_record", description: "Add nursing/clinical notes." },
  { key: "vitals.create", name: "Record vitals", module: "medical_record", description: "Record patient vitals." },
  { key: "vitals.view", name: "View vitals", module: "medical_record", description: "View recorded vitals." },

  // Lab
  { key: "lab.manage", name: "Manage lab", module: "lab", description: "Full control over lab operations." },
  { key: "lab_order.view", name: "View lab orders", module: "lab", description: "View pending lab orders." },
  { key: "lab_result.create", name: "Create lab results", module: "lab", description: "Enter new lab results." },
  { key: "lab_result.update", name: "Update lab results", module: "lab", description: "Edit lab results." },
  { key: "lab_report.view", name: "View lab reports", module: "lab", description: "View lab reports." },
  { key: "lab_report.upload", name: "Upload lab reports", module: "lab", description: "Upload a completed lab report." },

  // Pharmacy
  { key: "pharmacy.manage", name: "Manage pharmacy", module: "pharmacy", description: "Full control over pharmacy operations." },
  { key: "medicine.view", name: "View medicines", module: "pharmacy", description: "View the medicine catalog." },
  // Name and description must match migration 20261018000100_medicine_catalog_create exactly.
  { key: "medicine.catalog.create", name: "Add catalogue medicines", module: "pharmacy", description: "Add a medicine to the shared catalogue used by every clinic." },
  { key: "medicine.dispense", name: "Dispense medicine", module: "pharmacy", description: "Dispense medicine against a prescription." },
  { key: "pharmacy.inventory.view", name: "View pharmacy inventory", module: "pharmacy", description: "View medicine stock levels." },
  { key: "pharmacy.inventory.manage", name: "Manage pharmacy inventory", module: "pharmacy", description: "Adjust medicine stock and reorder levels." },

  // Billing
  { key: "billing.view", name: "View billing", module: "billing", description: "View invoices and payments." },
  { key: "billing.manage", name: "Manage billing", module: "billing", description: "Full control over invoices and payments." },
  { key: "billing.reports.view", name: "View billing reports", module: "billing", description: "View billing summary reports." },
  { key: "invoice.create", name: "Create invoices", module: "billing", description: "Generate a new invoice." },
  { key: "invoice.view", name: "View invoices", module: "billing", description: "View invoices." },
  { key: "invoice.update", name: "Update invoices", module: "billing", description: "Edit an invoice." },
  { key: "payment.create", name: "Record payments", module: "billing", description: "Record a payment against an invoice." },
  { key: "payment.view", name: "View payments", module: "billing", description: "View payment history." },
  { key: "refund.manage", name: "Manage refunds", module: "billing", description: "Process refunds." },
  { key: "financial_reports.view", name: "View financial reports", module: "reports", description: "View financial reports." },
  { key: "financial_reports.export", name: "Export financial reports", module: "reports", description: "Export financial reports." },

  // Reports
  { key: "reports.view", name: "View reports", module: "reports", description: "View clinic reports and analytics." },
  { key: "reports.export", name: "Export reports", module: "reports", description: "Export clinic reports." },
];

export const PERMISSION_BY_KEY: Record<string, Permission> = Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p]));

/** Default permission keys for each of the 12 built-in system roles — matches spec sections 2-5. */
export const ROLE_PERMISSION_DEFAULTS: Record<UserRole, string[]> = {
  super_admin: [
    "platform.clinic.manage",
    "platform.settings.manage",
    "platform.specialty.manage",
    "platform.user.manage",
    "platform.analytics.view",
    "platform.subscription.manage",
  ],
  clinic_owner: [
    "clinic.view", "clinic.update", "clinic.settings.manage", "clinic.delete",
    "branch.create", "branch.view", "branch.update", "branch.delete",
    "user.create", "user.view", "user.update", "user.disable", "role.manage",
    "doctor.manage", "doctor.view", "staff.manage", "staff.view",
    "patient.view", "patient.create", "patient.update",
    "appointment.view", "appointment.create", "appointment.update", "appointment.cancel",
    "prescription.view", "prescription.manage",
    "medical_record.view", "medical_record.manage",
    "billing.view", "billing.manage",
    "reports.view", "reports.export",
    "pharmacy.manage", "lab.manage",
  ],
  clinic_admin: [
    "clinic.view", "clinic.update", "clinic.settings.manage",
    "branch.create", "branch.view", "branch.update",
    "user.create", "user.view", "user.update", "user.disable", "role.manage",
    "doctor.manage", "doctor.view", "staff.manage", "staff.view",
    "patient.view", "patient.create", "patient.update",
    "appointment.view", "appointment.create", "appointment.update", "appointment.cancel",
    "prescription.view", "prescription.manage",
    "medical_record.view", "medical_record.manage",
    "billing.view", "billing.manage",
    "reports.view", "reports.export",
    "pharmacy.manage", "lab.manage",
    "medicine.catalog.create", // shared catalogue: Administrator only
  ],
  branch_manager: [
    "branch.view", "branch.update",
    "staff.view", "staff.manage", "doctor.view", "doctor.manage",
    "patient.view", "patient.create",
    "appointment.view", "appointment.create", "appointment.update",
    "billing.view", "reports.view",
    "pharmacy.inventory.view", // view-only stock for their branch (migration 20261017000000)
  ],
  doctor: [
    "profile.view", "profile.update",
    "own_appointments.view", "own_appointments.manage",
    "assigned_patients.view",
    "patient.medical_record.view", "patient.medical_record.update",
    "prescription.create", "prescription.update", "prescription.view",
    "lab_report.view",
    "medical_notes.create", "medical_notes.update",
    "online_consultation.manage",
  ],
  nurse: [
    "patient.view", "patient.basic_info.view",
    "vitals.create", "vitals.view",
    "appointment.view", "assigned_patients.view",
    "clinical_notes.create", "lab_report.view",
  ],
  lab_staff: [
    "lab_order.view", "lab_result.create", "lab_result.update",
    "lab_report.upload", "lab_report.view", "assigned_patient.view",
  ],
  pharmacist: [
    "prescription.view", "medicine.view", "medicine.dispense",
    "pharmacy.inventory.view", "pharmacy.inventory.manage", "billing.view",
  ],
  receptionist: [
    "patient.create", "patient.view", "patient.update_basic_info",
    "appointment.create", "appointment.view", "appointment.update", "appointment.cancel",
    "checkin.manage", "billing.view", "payment.create",
  ],
  billing_staff: [
    "invoice.create", "invoice.view", "invoice.update",
    "payment.create", "payment.view", "refund.manage", "billing.reports.view",
  ],
  accountant: [
    "billing.view", "payment.view", "invoice.view",
    "financial_reports.view", "financial_reports.export",
  ],
  patient: [
    "own_appointments.view", "own_appointments.manage",
    "prescription.view", "medical_record.view",
    "billing.view", "lab_report.view", "online_consultation.manage",
  ],
};

/** Human-readable label per role, extending the older ROLE_LABELS in lib/permissions.ts. */
export const ROLE_NAME: Record<UserRole, string> = {
  super_admin: "Super Admin",
  clinic_owner: "Clinic Owner",
  clinic_admin: "Clinic Admin",
  branch_manager: "Branch Manager",
  doctor: "Doctor",
  nurse: "Nurse",
  lab_staff: "Lab Technician",
  pharmacist: "Pharmacist",
  receptionist: "Receptionist",
  billing_staff: "Billing Staff",
  accountant: "Accountant",
  patient: "Patient",
};

export const ROLE_DESCRIPTION: Record<UserRole, string> = {
  super_admin: "Platform-level access across every clinic. Not a clinic user.",
  clinic_owner: "Full control of their clinic, including ownership and destructive actions.",
  clinic_admin: "Almost everything required to operate the clinic day to day.",
  branch_manager: "Manages a single assigned branch.",
  doctor: "Their own appointments, assigned patients, and clinical records.",
  nurse: "Vitals, clinical notes, and assigned patients.",
  lab_staff: "Lab orders, results, and reports.",
  pharmacist: "Prescriptions and pharmacy inventory.",
  receptionist: "Front-desk scheduling, check-in, and basic billing.",
  billing_staff: "Invoices, payments, and refunds.",
  accountant: "Financial reports and billing visibility, no clinical access.",
  patient: "Their own portal only.",
};

import type { UserRole } from "@/types";

export type Resource =
  | "patients"
  | "appointments"
  | "billing"
  | "clinical_records"
  | "prescriptions"
  | "inventory"
  | "staff"
  | "reports"
  | "settings"
  | "analytics";

export type Action = "view" | "create" | "edit" | "delete";

type ResourcePermissions = Partial<Record<Resource, Action[]>>;

const ALL: Action[] = ["view", "create", "edit", "delete"];
const VCE: Action[] = ["view", "create", "edit"];
const V: Action[] = ["view"];

const PERMISSION_MATRIX: Record<UserRole, ResourcePermissions> = {
  super_admin: {
    patients: ALL,
    appointments: ALL,
    billing: ALL,
    clinical_records: ALL,
    prescriptions: ALL,
    inventory: ALL,
    staff: ALL,
    reports: ALL,
    settings: ALL,
    analytics: V,
  },
  clinic_owner: {
    patients: ALL,
    appointments: ALL,
    billing: ALL,
    clinical_records: V,
    prescriptions: V,
    inventory: VCE,
    staff: ALL,
    reports: ALL,
    settings: ALL,
    analytics: V,
  },
  clinic_admin: {
    patients: VCE,
    appointments: ALL,
    billing: VCE,
    clinical_records: V,
    prescriptions: V,
    inventory: VCE,
    staff: ALL,
    reports: V,
    settings: VCE,
    analytics: V,
  },
  branch_manager: {
    patients: VCE,
    appointments: VCE,
    billing: V,
    staff: VCE,
    reports: V,
    settings: V,
  },
  doctor: {
    patients: VCE,
    appointments: VCE,
    billing: V,
    clinical_records: ALL,
    prescriptions: ALL,
    inventory: V,
    reports: VCE,
    analytics: V,
    settings: V,
  },
  receptionist: {
    patients: VCE,
    appointments: ALL,
    billing: VCE,
    clinical_records: V,
    reports: V,
    settings: V,
  },
  nurse: {
    patients: VCE,
    appointments: VCE,
    clinical_records: VCE,
    reports: V,
    settings: V,
  },
  pharmacist: {
    inventory: ALL,
    prescriptions: V,
    billing: VCE,
    settings: V,
  },
  lab_staff: {
    reports: ALL,
    patients: V,
    settings: V,
  },
  billing_staff: {
    billing: ALL,
    patients: V,
    reports: V,
  },
  accountant: {
    billing: V,
    reports: ALL,
  },
  patient: {
    patients: V,
    appointments: VCE,
    billing: V,
    prescriptions: V,
    reports: V,
  },
};

export function hasPermission(role: UserRole, resource: Resource, action: Action): boolean {
  const actions = PERMISSION_MATRIX[role]?.[resource];
  return Boolean(actions?.includes(action));
}

export function getPermissions(role: UserRole): ResourcePermissions {
  return PERMISSION_MATRIX[role] ?? {};
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  clinic_owner: "Clinic Owner",
  clinic_admin: "Clinic Admin",
  branch_manager: "Branch Manager",
  doctor: "Doctor",
  receptionist: "Receptionist",
  nurse: "Nurse",
  pharmacist: "Pharmacist",
  lab_staff: "Lab Staff",
  billing_staff: "Billing Staff",
  accountant: "Accountant",
  patient: "Patient",
};

/** Roles that use the internal clinic app shell rather than the patient portal. */
export function isStaffRole(role: UserRole): boolean {
  return role !== "patient";
}

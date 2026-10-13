// The tenant-level Clinic entity — a healthcare business onboarded onto
// Sehat Setu, owning one or more Branches. See services/clinics.ts for the
// unrelated "public directory of branches" concept, also historically
// called "clinics" from a patient's point of view.
import { delay } from "@/lib/async";
import { padId } from "@/lib/rng";
import { DEMO_NOW } from "@/lib/demo-clock";
import { getDb, mutateDb } from "@/store/data-store";
import { logAudit } from "@/services/audit";
import { AVATAR_COLORS } from "@/data/pools";
import { ROLE_PERMISSION_DEFAULTS } from "@/data/permission-catalog";
import type { Branch, Clinic, ClinicType, Department, DoctorAvailabilitySlot, Role, Specialty, StaffMember } from "@/types";

export async function listClinicsForPlatform(): Promise<Clinic[]> {
  await delay(300);
  return getDb().clinics;
}

export async function getClinic(id: string): Promise<Clinic | undefined> {
  await delay(200);
  return getDb().clinics.find((c) => c.id === id);
}

export async function updateClinicSettings(id: string, patch: Partial<Clinic["settings"]>): Promise<Clinic> {
  await delay(350);
  let updated: Clinic | undefined;
  mutateDb((d) => ({
    ...d,
    clinics: d.clinics.map((c) => {
      if (c.id !== id) return c;
      updated = { ...c, settings: { ...c.settings, ...patch } };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Clinic not found");
  return updated;
}

export async function updateClinicStatus(id: string, status: Clinic["status"]): Promise<void> {
  await delay(300);
  mutateDb((d) => ({ ...d, clinics: d.clinics.map((c) => (c.id === id ? { ...c, status } : c)) }));
}

// ---------------------------------------------------------------------------
// Clinic onboarding — creates a full new tenant: clinic, specialties,
// first branch, owner account, and its 12 system roles, in one transaction.
// ---------------------------------------------------------------------------

export interface OnboardClinicInput {
  clinic: {
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
  };
  specialtyIds: string[];
  customSpecialtyNames: string[];
  branch: {
    name: string;
    code?: string;
    address: string;
    phone: string;
    email?: string;
    workingHours?: string;
    timezone?: string;
  };
  owner: {
    name: string;
    email: string;
    mobile: string;
    password: string;
  };
  settings: {
    appointmentDurationMinutes: number;
    currency: string;
    workingDays: DoctorAvailabilitySlot["day"][];
    onlineConsultationEnabled: boolean;
    smsNotificationsEnabled: boolean;
    emailNotificationsEnabled: boolean;
  };
}

export interface OnboardClinicResult {
  clinic: Clinic;
  branch: Branch;
  owner: StaffMember;
  roles: Role[];
  specialties: Specialty[];
}

const SYSTEM_ROLE_BASES = [
  "super_admin", "clinic_owner", "clinic_admin", "branch_manager", "doctor",
  "nurse", "lab_staff", "pharmacist", "receptionist", "billing_staff", "accountant", "patient",
] as const;

export async function onboardClinic(input: OnboardClinicInput): Promise<OnboardClinicResult> {
  await delay(700);
  const db = getDb();

  const clinicId = padId("CL", db.clinics.length + 1, 3);
  const clinic: Clinic = {
    id: clinicId,
    name: input.clinic.name,
    type: input.clinic.type,
    email: input.clinic.email,
    phone: input.clinic.phone,
    website: input.clinic.website,
    address: input.clinic.address,
    city: input.clinic.city,
    state: input.clinic.state,
    country: input.clinic.country,
    pincode: input.clinic.pincode,
    status: "active",
    ownerId: "", // set below once the owner staff row exists
    createdAt: DEMO_NOW.toISOString(),
    settings: {
      currency: input.settings.currency,
      appointmentDurationMinutes: input.settings.appointmentDurationMinutes,
      workingDays: input.settings.workingDays,
      onlineConsultationEnabled: input.settings.onlineConsultationEnabled,
      smsNotificationsEnabled: input.settings.smsNotificationsEnabled,
      emailNotificationsEnabled: input.settings.emailNotificationsEnabled,
    },
  };

  const branchId = padId("BR", db.branches.length + 1, 3);
  const branch: Branch = {
    id: branchId,
    clinicId,
    name: input.branch.name,
    code: input.branch.code,
    city: input.clinic.city,
    address: input.branch.address,
    phone: input.branch.phone,
    email: input.branch.email,
    workingHours: input.branch.workingHours,
    timezone: input.branch.timezone ?? "Asia/Kolkata",
    isHeadOffice: true,
    status: "active",
  };

  const ownerId = padId("ST", db.staff.length + 1, 3);
  const owner: StaffMember = {
    id: ownerId,
    clinicId,
    name: input.owner.name,
    role: "clinic_owner",
    branchId,
    phone: input.owner.mobile,
    email: input.owner.email,
    status: "active",
    lastActiveAt: DEMO_NOW.toISOString(),
    joinedDate: DEMO_NOW.toISOString().slice(0, 10),
    avatarColor: AVATAR_COLORS[db.staff.length % AVATAR_COLORS.length],
    password: input.owner.password,
  };
  clinic.ownerId = ownerId;

  const roles: Role[] = SYSTEM_ROLE_BASES.filter((r) => r !== "super_admin").map((role) => ({
    id: `ROLE-${clinicId}-${role.toUpperCase()}`,
    name: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: `System role for ${role.replace(/_/g, " ")}.`,
    scope: "clinic",
    clinicId,
    isSystemRole: true,
    baseRole: role,
    permissionKeys: ROLE_PERMISSION_DEFAULTS[role],
  }));

  const customSpecialties: Specialty[] = input.customSpecialtyNames
    .filter((name) => name.trim().length > 0)
    .map((name, i) => ({
      id: padId("SP", db.specialties.length + i + 1, 3),
      name: name.trim(),
      description: `Custom specialty added by ${clinic.name}.`,
      services: [],
      status: "active" as const,
    }));

  const clinicSpecialtyRows = [
    ...input.specialtyIds.map((specialtyId) => ({ clinicId, specialtyId })),
    ...customSpecialties.map((s) => ({ clinicId, specialtyId: s.id })),
  ];

  const department: Department = {
    id: padId("DEPT", db.departments.length + 1, 4),
    clinicId,
    branchId,
    name: "General",
    description: "Default department created with the clinic.",
    status: "active",
  };

  mutateDb((d) => ({
    ...d,
    clinics: [...d.clinics, clinic],
    branches: [...d.branches, branch],
    staff: [...d.staff, owner],
    roles: [...d.roles, ...roles],
    specialties: [...d.specialties, ...customSpecialties],
    clinicSpecialties: [...d.clinicSpecialties, ...clinicSpecialtyRows],
    departments: [...d.departments, department],
  }));

  logAudit({
    actor: { name: input.owner.name, role: "clinic_owner" },
    action: "Created clinic",
    entityType: "clinic",
    entityId: clinicId,
    branchId,
  });

  return { clinic, branch, owner, roles, specialties: customSpecialties };
}

import { padId } from "@/lib/rng";
import { ROLE_DESCRIPTION, ROLE_NAME, ROLE_PERMISSION_DEFAULTS } from "@/data/permission-catalog";
import { SPECIALTY_CATALOG } from "@/data/pools";
import type { Clinic, ClinicSpecialty, Department, Doctor, Role, Specialty, UserRole } from "@/types";

export const SEED_CLINIC_ID = "CL-001";

export function generateSpecialties(): Specialty[] {
  return SPECIALTY_CATALOG.map((s, i) => ({
    id: padId("SP", i + 1, 2),
    name: s.name,
    description: s.description,
    services: s.services,
    status: "active",
  }));
}

/** SPECIALIZATIONS (the free-text pool used by seeded doctors) map 1:1 onto a subset of the broader SPECIALTY_CATALOG by name, except "General Physician" / "Internal Medicine" both map onto "General Medicine". */
export function specialtyIdForSpecialization(specialties: Specialty[], specialization: string): string | undefined {
  const name = specialization === "General Physician" || specialization === "Internal Medicine" ? "General Medicine" : specialization;
  return specialties.find((s) => s.name === name)?.id;
}

export function generateClinic(): Clinic {
  return {
    id: SEED_CLINIC_ID,
    name: "Sehat Setu Multispeciality Group",
    type: "multi_specialty",
    email: "owner@sehatsetu.demo",
    phone: "+91 172 4560001",
    website: "https://sehatsetu.demo",
    address: "SCO 42-43, Sector 17",
    city: "Chandigarh",
    state: "Punjab",
    country: "India",
    pincode: "160017",
    status: "active",
    ownerId: "ST-OWNER-001",
    createdAt: "2022-04-01T00:00:00.000Z",
    settings: {
      currency: "INR",
      appointmentDurationMinutes: 30,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      onlineConsultationEnabled: true,
      smsNotificationsEnabled: true,
      emailNotificationsEnabled: true,
    },
  };
}

export function generateClinicSpecialties(clinicId: string, specialties: Specialty[]): ClinicSpecialty[] {
  // The seeded clinic offers every specialty that has at least one seeded doctor, plus a
  // handful of others from the broader catalog so the specialty-management UI has real breadth to show.
  const active = new Set(["General Medicine", "Cardiology", "Dermatology", "Pediatrics", "Gynecology", "Orthopedics", "ENT", "Ophthalmology", "Psychiatry", "Endocrinology", "Pulmonology", "Dentistry", "Physiotherapy", "Radiology", "Pathology"]);
  return specialties.filter((s) => active.has(s.name)).map((s) => ({ clinicId, specialtyId: s.id }));
}

const SYSTEM_ROLES: UserRole[] = [
  "super_admin", "clinic_owner", "clinic_admin", "branch_manager", "doctor",
  "nurse", "lab_staff", "pharmacist", "receptionist", "billing_staff", "accountant", "patient",
];

export function generateRoles(clinicId: string): Role[] {
  return SYSTEM_ROLES.map((role) => ({
    id: role === "super_admin" ? "ROLE-PLATFORM-SUPER-ADMIN" : `ROLE-${clinicId}-${role.toUpperCase()}`,
    name: ROLE_NAME[role],
    description: ROLE_DESCRIPTION[role],
    scope: role === "super_admin" ? "platform" : "clinic",
    clinicId: role === "super_admin" ? undefined : clinicId,
    isSystemRole: true,
    baseRole: role,
    permissionKeys: ROLE_PERMISSION_DEFAULTS[role],
  }));
}

/** One department per (branch, specialization) pair that actually has a seeded doctor there — headed by that department's highest-rated doctor. */
export function generateDepartments(clinicId: string, doctors: Doctor[], specialties: Specialty[]): Department[] {
  const groups = new Map<string, Doctor[]>();
  for (const doc of doctors) {
    const key = `${doc.branchId}::${doc.specialization}`;
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }

  const departments: Department[] = [];
  let i = 0;
  for (const [key, docs] of groups) {
    const [branchId, specialization] = key.split("::");
    const specialtyId = specialtyIdForSpecialization(specialties, specialization);
    const head = [...docs].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    i++;
    departments.push({
      id: padId("DEPT", i, 3),
      clinicId,
      branchId,
      name: `${specialization} Department`,
      specialtyId,
      description: `${specialization} services at this branch.`,
      headUserId: head?.id,
      status: "active",
    });
  }
  return departments;
}

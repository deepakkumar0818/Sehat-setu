import type { AuthUser, DemoAccount, Doctor, Patient, SehatSetuDatabase, StaffMember, UserRole } from "@/types";
import { AVATAR_COLORS } from "@/data/pools";

export const DEMO_PASSWORD = "Demo@123";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "admin@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "clinic_admin",
    label: "Clinic Admin",
    description: "Runs day-to-day clinic operations across branches",
  },
  {
    email: "doctor@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "doctor",
    label: "Doctor",
    description: "Consultations, prescriptions and patient records",
  },
  {
    email: "reception@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "receptionist",
    label: "Receptionist",
    description: "Appointments, check-ins and front-desk billing",
  },
  {
    email: "patient@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "patient",
    label: "Patient",
    description: "Personal health records via the patient portal",
  },
  {
    email: "nurse@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "nurse",
    label: "Nurse",
    description: "Vitals capture and clinical assistance",
  },
  {
    email: "pharmacist@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "pharmacist",
    label: "Pharmacist",
    description: "Medicine inventory and dispensing",
  },
  {
    email: "lab@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "lab_staff",
    label: "Lab Technician",
    description: "Lab orders, results and report uploads",
  },
  {
    email: "superadmin@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "super_admin",
    label: "Super Admin",
    description: "Oversees the Sehat Setu platform across all clinics",
  },
  {
    email: "owner@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "clinic_owner",
    label: "Clinic Owner",
    description: "Full control of the clinic, including ownership actions",
  },
  {
    email: "branchmanager@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "branch_manager",
    label: "Branch Manager",
    description: "Manages a single assigned branch",
  },
  {
    email: "billing@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "billing_staff",
    label: "Billing Staff",
    description: "Invoices, payments and refunds",
  },
  {
    email: "accountant@sehatsetu.demo",
    password: DEMO_PASSWORD,
    role: "accountant",
    label: "Accountant",
    description: "Financial reports and billing visibility",
  },
];

function lastName(name: string): string {
  const parts = name.replace("Dr. ", "").trim().split(/\s+/);
  return parts[parts.length - 1];
}

/** The system Role id for a given (clinic, base role) pair — see data/seed/tenants.ts#generateRoles. */
function systemRoleId(clinicId: string | undefined, role: UserRole): string | undefined {
  if (role === "super_admin") return "ROLE-PLATFORM-SUPER-ADMIN";
  return clinicId ? `ROLE-${clinicId}-${role.toUpperCase()}` : undefined;
}

function buildDoctorAuthUser(doctor: Doctor): AuthUser {
  return {
    id: `USR-${doctor.id}`,
    name: doctor.name,
    email: doctor.email,
    role: "doctor",
    avatarColor: doctor.avatarColor,
    clinicId: doctor.clinicId,
    branchId: doctor.branchId,
    departmentId: doctor.departmentId,
    doctorId: doctor.id,
    roleId: systemRoleId(doctor.clinicId, "doctor"),
    title: "Dr.",
  };
}

function buildPatientAuthUser(patient: Patient): AuthUser {
  return {
    id: `USR-${patient.id}`,
    name: patient.name,
    email: patient.email,
    role: "patient",
    avatarColor: patient.avatarColor,
    branchId: patient.branchId,
    patientId: patient.id,
    // Patients are platform-level identities, not owned by one clinic (see
    // the Patient type doc comment) — no clinicId/roleId is attached here.
  };
}

function buildStaffAuthUser(member: StaffMember): AuthUser {
  return {
    id: `USR-${member.id}`,
    name: member.name,
    email: member.email,
    role: member.role,
    avatarColor: member.avatarColor,
    clinicId: member.clinicId,
    branchId: member.branchId,
    departmentId: member.departmentId,
    staffId: member.id,
    roleId: systemRoleId(member.clinicId, member.role),
    title: member.role === "clinic_admin" ? "Admin" : member.role === "clinic_owner" ? "Owner" : undefined,
  };
}

/**
 * Resolves a demo role to a concrete, connected identity within the seeded
 * database so the logged-in persona sees data that actually belongs to them
 * (their own appointments, patients, prescriptions, etc.) rather than an
 * unlinked placeholder. Entity ids are positionally stable across reseeds.
 */
export function resolveDemoUser(role: UserRole, db: SehatSetuDatabase): AuthUser {
  switch (role) {
    case "doctor":
      return buildDoctorAuthUser(db.doctors[0]);
    case "patient":
      return buildPatientAuthUser(db.patients[0]);
    case "clinic_owner":
    case "clinic_admin":
    case "branch_manager":
    case "receptionist":
    case "nurse":
    case "pharmacist":
    case "lab_staff":
    case "billing_staff":
    case "accountant":
      return buildStaffAuthUser(db.staff.find((s) => s.role === role) ?? db.staff[0]);
    case "super_admin":
    default:
      return {
        id: "USR-SA-001",
        name: "Aditi Malhotra",
        email: "superadmin@sehatsetu.demo",
        role: "super_admin",
        avatarColor: AVATAR_COLORS[0],
        roleId: "ROLE-PLATFORM-SUPER-ADMIN",
        title: "Super Admin",
      };
  }
}

export function getGreetingName(user: AuthUser): string {
  if (user.title === "Dr.") return `Dr. ${lastName(user.name)}`;
  return user.name.split(" ")[0];
}

export function findDemoAccount(email: string, password: string): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password
  );
}

/**
 * Authenticates against BOTH the canonical demo-role accounts AND any real
 * doctor, staff member, or patient in the current database — including ones
 * added after the app started (e.g. via "Add Doctor", clinic onboarding) or
 * who registered themselves as a patient (see registerPatient). Every
 * account shares the one demo password EXCEPT self-registered patients and
 * a clinic owner created via onboarding, who set their own at signup.
 */
export function authenticateUser(email: string, password: string, db: SehatSetuDatabase): AuthUser | undefined {
  const normalizedEmail = email.trim().toLowerCase();

  // Self-registered patients set their own password at signup.
  const patient = db.patients.find((p) => p.email.toLowerCase() === normalizedEmail);
  if (patient?.password) {
    return password === patient.password ? buildPatientAuthUser(patient) : undefined;
  }

  // A clinic owner created via the onboarding wizard also sets their own password.
  const staffWithPassword = db.staff.find((s) => s.email.toLowerCase() === normalizedEmail);
  if (staffWithPassword?.password) {
    return password === staffWithPassword.password ? buildStaffAuthUser(staffWithPassword) : undefined;
  }

  if (password !== DEMO_PASSWORD) return undefined;

  const demoAccount = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === normalizedEmail);
  if (demoAccount) return resolveDemoUser(demoAccount.role, db);

  const doctor = db.doctors.find((d) => d.email.toLowerCase() === normalizedEmail);
  if (doctor) return buildDoctorAuthUser(doctor);

  const staff = db.staff.find((s) => s.email.toLowerCase() === normalizedEmail);
  if (staff) return buildStaffAuthUser(staff);

  if (patient) return buildPatientAuthUser(patient);

  return undefined;
}

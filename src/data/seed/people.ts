import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type { Branch, Doctor, Gender, StaffMember, StaffRole } from "@/types";
import {
  AVATAR_COLORS,
  DOCTOR_QUALIFICATIONS,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  SPECIALIZATIONS,
} from "@/data/pools";

export function randomPersonName(rng: Rng, gender: Gender): string {
  const first = gender === "female" ? rng.pick(FEMALE_FIRST_NAMES) : rng.pick(MALE_FIRST_NAMES);
  return `${first} ${rng.pick(LAST_NAMES)}`;
}

function emailFromName(name: string, domain: string): string {
  return `${name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, ".")}@${domain}`;
}

function phoneFromIndex(i: number): string {
  return `+91 98${String(10000000 + i * 37).slice(0, 8)}`;
}

export function generateDoctors(rng: Rng, branches: Branch[], now: Date, clinicId: string, count = 9): Doctor[] {
  const doctors: Doctor[] = [];
  for (let i = 0; i < count; i++) {
    const gender: Gender = rng.bool(0.55) ? "male" : "female";
    const name = `Dr. ${randomPersonName(rng, gender)}`;
    const branch = branches[i % branches.length];
    const experienceYears = rng.int(3, 26);
    const joined = rng.dateOffset(now, -365 * Math.min(experienceYears, 8), -30);
    const specialization = rng.pick(SPECIALIZATIONS);
    doctors.push({
      id: padId("DR", i + 1, 3),
      clinicId,
      name,
      gender,
      qualifications: rng.pick(DOCTOR_QUALIFICATIONS),
      specialization,
      registrationNumber: `MED-${String(100000 + i * 731).slice(0, 6)}`,
      experienceYears,
      consultationFee: rng.int(8, 30) * 50,
      branchId: branch.id,
      phone: phoneFromIndex(i),
      email: emailFromName(name.replace("Dr. ", ""), "sehatsetu.demo"),
      status: i === count - 1 ? "on_leave" : "active",
      onlineConsultation: rng.bool(0.7),
      rating: rng.float(3.8, 5.0, 1),
      avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      bio: `${name} specializes in ${specialization.toLowerCase()} with ${experienceYears} years of clinical experience.`,
      availability: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
        day: day as Doctor["availability"][number]["day"],
        start: "09:00",
        end: day === "Sat" ? "14:00" : "17:00",
      })),
      joinedDate: joined.toISOString().slice(0, 10),
    });
  }
  return doctors;
}

const STAFF_ROLE_PLAN: { role: StaffRole; perBranch: number }[] = [
  { role: "branch_manager", perBranch: 1 },
  { role: "clinic_admin", perBranch: 1 },
  { role: "receptionist", perBranch: 2 },
  { role: "nurse", perBranch: 2 },
  { role: "pharmacist", perBranch: 1 },
  { role: "lab_staff", perBranch: 1 },
];

/** Clinic-level (not per-branch) staff — seeded once at the head office. */
const CLINIC_LEVEL_ROLES: StaffRole[] = ["clinic_owner", "billing_staff", "accountant"];

export function generateStaff(rng: Rng, branches: Branch[], now: Date, clinicId: string): StaffMember[] {
  const staff: StaffMember[] = [];
  let counter = 1;
  const headOffice = branches.find((b) => b.isHeadOffice) ?? branches[0];

  for (const role of CLINIC_LEVEL_ROLES) {
    const gender: Gender = rng.bool(0.5) ? "male" : "female";
    const name = randomPersonName(rng, gender);
    const joined = rng.dateOffset(now, -1200, -400);
    staff.push({
      id: role === "clinic_owner" ? "ST-OWNER-001" : padId("ST", counter, 3),
      clinicId,
      name,
      role,
      branchId: headOffice.id,
      phone: phoneFromIndex(100 + counter),
      email: emailFromName(name, "sehatsetu.demo"),
      status: "active",
      lastActiveAt: rng.dateOffset(now, -14, 0).toISOString(),
      joinedDate: joined.toISOString().slice(0, 10),
      avatarColor: AVATAR_COLORS[counter % AVATAR_COLORS.length],
    });
    counter++;
  }

  for (const branch of branches) {
    for (const plan of STAFF_ROLE_PLAN) {
      for (let i = 0; i < plan.perBranch; i++) {
        const gender: Gender = rng.bool(0.5) ? "male" : "female";
        const name = randomPersonName(rng, gender);
        const joined = rng.dateOffset(now, -900, -20);
        staff.push({
          id: padId("ST", counter, 3),
          clinicId,
          name,
          role: plan.role,
          branchId: branch.id,
          phone: phoneFromIndex(100 + counter),
          email: emailFromName(name, "sehatsetu.demo"),
          status: rng.bool(0.92) ? "active" : "inactive",
          lastActiveAt: rng.dateOffset(now, -14, 0).toISOString(),
          joinedDate: joined.toISOString().slice(0, 10),
          avatarColor: AVATAR_COLORS[counter % AVATAR_COLORS.length],
        });
        counter++;
      }
    }
  }
  return staff;
}

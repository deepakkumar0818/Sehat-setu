import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { DEMO_NOW } from "@/lib/demo-clock";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { AVATAR_COLORS } from "@/data/pools";
import type { Doctor, StaffMember, StaffRole } from "@/types";

export interface ListDoctorsParams {
  search?: string;
  branchId?: string | "all";
  specialization?: string | "all";
  gender?: Doctor["gender"] | "all";
  minExperience?: number;
  maxFee?: number;
  onlineOnly?: boolean;
  availableToday?: boolean;
  sortBy?: "relevance" | "experience" | "fee_low" | "fee_high" | "rating";
  page?: number;
  pageSize?: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export async function listDoctors(params: ListDoctorsParams = {}): Promise<PagedResult<Doctor>> {
  await delay();
  const {
    search = "",
    branchId = "all",
    specialization = "all",
    gender = "all",
    minExperience,
    maxFee,
    onlineOnly = false,
    availableToday = false,
    sortBy = "relevance",
    page = 1,
    pageSize = 12,
  } = params;
  const todayLabel = WEEKDAY_LABELS[DEMO_NOW.getDay()];

  let items = getDb().doctors.filter((d) => {
    if (branchId !== "all" && d.branchId !== branchId) return false;
    if (specialization !== "all" && d.specialization !== specialization) return false;
    if (gender !== "all" && d.gender !== gender) return false;
    if (minExperience !== undefined && d.experienceYears < minExperience) return false;
    if (maxFee !== undefined && d.consultationFee > maxFee) return false;
    if (onlineOnly && !d.onlineConsultation) return false;
    if (availableToday && !d.availability.some((slot) => slot.day === todayLabel)) return false;
    return matchesSearch([d.name, d.specialization, d.email], search);
  });

  if (sortBy !== "relevance") {
    items = [...items].sort((a, b) => {
      if (sortBy === "experience") return b.experienceYears - a.experienceYears;
      if (sortBy === "fee_low") return a.consultationFee - b.consultationFee;
      if (sortBy === "fee_high") return b.consultationFee - a.consultationFee;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
  }

  return paginate(items, page, pageSize);
}

export async function getDoctor(id: string): Promise<Doctor | undefined> {
  await delay(250);
  return getDb().doctors.find((d) => d.id === id);
}

export async function updateDoctor(id: string, patch: Partial<Doctor>): Promise<Doctor> {
  await delay(350);
  let updated: Doctor | undefined;
  mutateDb((d) => ({
    ...d,
    doctors: d.doctors.map((doc) => {
      if (doc.id !== id) return doc;
      updated = { ...doc, ...patch };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Doctor not found");
  return updated;
}

export interface CreateDoctorInput {
  name: string;
  gender: Doctor["gender"];
  qualifications: string;
  specialization: string;
  specialtyId?: string;
  departmentId?: string;
  registrationNumber?: string;
  experienceYears: number;
  consultationFee: number;
  branchId: string;
  phone: string;
  email: string;
  onlineConsultation: boolean;
  bio?: string;
}

export async function createDoctor(input: CreateDoctorInput): Promise<Doctor> {
  await delay(400);
  const db = getDb();
  const branch = db.branches.find((b) => b.id === input.branchId);
  if (!branch) throw new Error("Branch not found");
  const doctor: Doctor = {
    id: padId("DR", db.doctors.length + 1, 3),
    clinicId: branch.clinicId,
    name: input.name.startsWith("Dr.") ? input.name : `Dr. ${input.name}`,
    gender: input.gender,
    qualifications: input.qualifications,
    specialization: input.specialization,
    specialtyId: input.specialtyId,
    departmentId: input.departmentId,
    registrationNumber: input.registrationNumber,
    experienceYears: input.experienceYears,
    consultationFee: input.consultationFee,
    branchId: input.branchId,
    phone: input.phone,
    email: input.email,
    status: "active",
    onlineConsultation: input.onlineConsultation,
    rating: 4.5,
    avatarColor: AVATAR_COLORS[db.doctors.length % AVATAR_COLORS.length],
    bio: input.bio || `Specializes in ${input.specialization.toLowerCase()} with ${input.experienceYears} years of clinical experience.`,
    availability: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
      day: day as Doctor["availability"][number]["day"],
      start: "09:00",
      end: day === "Sat" ? "14:00" : "17:00",
    })),
    joinedDate: new Date().toISOString().slice(0, 10),
  };
  mutateDb((d) => ({ ...d, doctors: [doctor, ...d.doctors] }));
  return doctor;
}

export interface ListStaffParams {
  search?: string;
  role?: StaffRole | "all";
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listStaff(params: ListStaffParams = {}): Promise<PagedResult<StaffMember>> {
  await delay();
  const { search = "", role = "all", branchId = "all", page = 1, pageSize = 12 } = params;
  const items = getDb().staff.filter((s) => {
    if (role !== "all" && s.role !== role) return false;
    if (branchId !== "all" && s.branchId !== branchId) return false;
    return matchesSearch([s.name, s.email, s.phone], search);
  });
  return paginate(items, page, pageSize);
}

export async function getStaffMember(id: string): Promise<StaffMember | undefined> {
  await delay(250);
  return getDb().staff.find((s) => s.id === id);
}

export async function updateStaffStatus(id: string, status: StaffMember["status"]): Promise<void> {
  await delay(300);
  mutateDb((d) => ({ ...d, staff: d.staff.map((s) => (s.id === id ? { ...s, status } : s)) }));
}

export interface CreateStaffInput {
  name: string;
  role: StaffRole;
  branchId: string;
  departmentId?: string;
  phone: string;
  email: string;
}

export async function createStaff(input: CreateStaffInput): Promise<StaffMember> {
  await delay(400);
  const db = getDb();
  const branch = db.branches.find((b) => b.id === input.branchId);
  if (!branch) throw new Error("Branch not found");
  const member: StaffMember = {
    id: padId("ST", db.staff.length + 1, 3),
    ...input,
    clinicId: branch.clinicId,
    status: "active",
    lastActiveAt: new Date().toISOString(),
    joinedDate: new Date().toISOString().slice(0, 10),
    avatarColor: AVATAR_COLORS[db.staff.length % AVATAR_COLORS.length],
  };
  mutateDb((d) => ({ ...d, staff: [member, ...d.staff] }));
  return member;
}

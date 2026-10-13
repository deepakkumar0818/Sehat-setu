import { delay, matchesSearch } from "@/lib/async";
import { getDb } from "@/store/data-store";
import type { Branch, Doctor } from "@/types";

// NOTE: "Clinic" here means a public-facing *location* a patient can browse
// — it's the same entity as an internal Branch, presented for the public
// directory/profile pages instead of duplicating the data model. This is a
// DIFFERENT concept from the tenant-level `Clinic` type in types/index.ts
// (the business/organization that owns one or more Branches — see
// src/services/tenant-clinics.ts for that one). A patient browsing
// "clinics near me" is really browsing branches of some tenant clinic.

export interface ClinicWithStats extends Branch {
  doctorCount: number;
  specialties: string[];
}

function enrich(branch: Branch, doctors: Doctor[]): ClinicWithStats {
  const branchDoctors = doctors.filter((d) => d.branchId === branch.id && d.status === "active");
  return {
    ...branch,
    doctorCount: branchDoctors.length,
    specialties: [...new Set(branchDoctors.map((d) => d.specialization))],
  };
}

export async function listClinics(search = ""): Promise<ClinicWithStats[]> {
  await delay(300);
  const db = getDb();
  return db.branches
    .filter((b) => matchesSearch([b.name, b.city, b.address], search))
    .map((b) => enrich(b, db.doctors));
}

export async function getClinic(id: string): Promise<ClinicWithStats | undefined> {
  await delay(250);
  const db = getDb();
  const branch = db.branches.find((b) => b.id === id);
  return branch ? enrich(branch, db.doctors) : undefined;
}

export async function getClinicDoctors(id: string): Promise<Doctor[]> {
  await delay(250);
  return getDb().doctors.filter((d) => d.branchId === id && d.status === "active");
}

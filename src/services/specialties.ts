// Centralized specialty data/service layer — the master Specialty catalog
// plus which specialties a given clinic has enabled (ClinicSpecialty).
import { delay, matchesSearch } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { logAudit } from "@/services/audit";
import type { AuthUser, Specialty } from "@/types";

export async function listSpecialtyCatalog(search = ""): Promise<Specialty[]> {
  await delay(200);
  return getDb().specialties.filter((s) => matchesSearch([s.name, s.description], search));
}

export interface ClinicSpecialtyRow extends Specialty {
  doctorCount: number;
  enabled: boolean;
}

/** Every specialty in the catalog, annotated with whether this clinic has it enabled and how many active doctors it has. */
export async function listSpecialtiesForClinic(clinicId: string): Promise<ClinicSpecialtyRow[]> {
  await delay(250);
  const db = getDb();
  const enabledIds = new Set(db.clinicSpecialties.filter((cs) => cs.clinicId === clinicId).map((cs) => cs.specialtyId));
  return db.specialties.map((s) => ({
    ...s,
    enabled: enabledIds.has(s.id),
    doctorCount: db.doctors.filter((d) => d.clinicId === clinicId && d.specialtyId === s.id && d.status === "active").length,
  }));
}

export async function setClinicSpecialtyEnabled(clinicId: string, specialtyId: string, enabled: boolean, actor: Pick<AuthUser, "name" | "role">): Promise<void> {
  await delay(300);
  mutateDb((d) => {
    const already = d.clinicSpecialties.some((cs) => cs.clinicId === clinicId && cs.specialtyId === specialtyId);
    if (enabled && !already) {
      return { ...d, clinicSpecialties: [...d.clinicSpecialties, { clinicId, specialtyId }] };
    }
    if (!enabled && already) {
      return { ...d, clinicSpecialties: d.clinicSpecialties.filter((cs) => !(cs.clinicId === clinicId && cs.specialtyId === specialtyId)) };
    }
    return d;
  });
  logAudit({ actor, action: enabled ? "Enabled specialty" : "Disabled specialty", entityType: "specialty", entityId: specialtyId });
}

export interface CreateSpecialtyInput {
  name: string;
  description: string;
  services: string[];
  clinicId: string;
  actor: Pick<AuthUser, "name" | "role">;
}

export async function createSpecialty(input: CreateSpecialtyInput): Promise<Specialty> {
  await delay(350);
  const db = getDb();
  const specialty: Specialty = {
    id: padId("SP", db.specialties.length + 1, 3),
    name: input.name,
    description: input.description,
    services: input.services,
    status: "active",
  };
  mutateDb((d) => ({
    ...d,
    specialties: [...d.specialties, specialty],
    clinicSpecialties: [...d.clinicSpecialties, { clinicId: input.clinicId, specialtyId: specialty.id }],
  }));
  logAudit({ actor: input.actor, action: "Created specialty", entityType: "specialty", entityId: specialty.id });
  return specialty;
}

export async function toggleSpecialtyStatus(specialtyId: string, status: Specialty["status"]): Promise<void> {
  await delay(250);
  mutateDb((d) => ({ ...d, specialties: d.specialties.map((s) => (s.id === specialtyId ? { ...s, status } : s)) }));
}

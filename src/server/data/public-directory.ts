import "server-only";
import { prisma } from "@/server/prisma";
import type { PublicDirectory } from "@/lib/live-types";
import { logServerError } from "@/server/log";

// The signed-out website's doctor directory, from app.public_doctor_directory()
// (migration 20261031000000): listing fields of ACTIVE doctors at ACTIVE
// branches only — no registration numbers, contact details of people, patients
// or schedules. Runs as the runtime role with no user context; the function is
// the only thing it can read that way.

type Raw = {
  clinics: PublicDirectory["clinics"];
  branches: PublicDirectory["branches"];
  doctors: (Omit<PublicDirectory["doctors"][number], "consultationFee"> & { consultationFeePaise: number })[];
};

export async function getPublicDirectory(): Promise<PublicDirectory> {
  const rows = await prisma.$queryRaw<{ directory: Raw }[]>`SELECT app.public_doctor_directory() AS directory`;
  const raw = rows[0]?.directory ?? { clinics: [], branches: [], doctors: [] };
  return {
    clinics: raw.clinics,
    branches: raw.branches,
    doctors: raw.doctors.map(({ consultationFeePaise, ...d }) => ({ ...d, consultationFee: consultationFeePaise / 100 })),
  };
}

export interface JoinClinic {
  id: string;
  code: string;
  name: string;
  city: string;
}

/**
 * The ACTIVE clinic a patient link (/join/<CODE>) names, from
 * app.public_clinic_by_code (migration 20261106000000), or null.
 */
export async function findClinicByCode(code: string): Promise<JoinClinic | null> {
  const rows = await prisma.$queryRaw<{ clinic: JoinClinic | null }[]>`SELECT app.public_clinic_by_code(${code}) AS clinic`;
  return rows[0]?.clinic ?? null;
}

/** The directory, or null when it can't be read (shown as "unavailable", never as sample data). */
export async function tryPublicDirectory(): Promise<PublicDirectory | null> {
  try {
    return await getPublicDirectory();
  } catch (err) {
    logServerError("public directory", err);
    return null;
  }
}

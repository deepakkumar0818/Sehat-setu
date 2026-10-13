import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type { Branch } from "@/types";
import { BRANCHES } from "@/data/pools";

const BRANCH_CODES = ["CHD-001", "MOH-001", "PKL-001", "DEL-001", "GGN-001"];

export function generateBranches(clinicId: string): Branch[] {
  return BRANCHES.map((b, i) => ({
    id: padId("BR", i + 1, 2),
    clinicId,
    name: b.name,
    code: BRANCH_CODES[i],
    city: b.city,
    address: b.address,
    phone: `+91 172${String(1000000 + i * 1111).slice(0, 7)}`,
    email: `${b.city.toLowerCase()}@sehatsetu.demo`,
    workingHours: "9:00 AM - 6:00 PM",
    timezone: "Asia/Kolkata",
    isHeadOffice: i === 0,
    status: "active",
  }));
}

export function pickBranchId(rng: Rng, branches: Branch[]): string {
  return rng.pick(branches).id;
}

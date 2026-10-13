import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type { Branch, Gender, Patient } from "@/types";
import { randomPersonName } from "@/data/seed/people";
import { ALLERGIES, AVATAR_COLORS, CHRONIC_CONDITIONS, LAST_NAMES } from "@/data/pools";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONS = ["Spouse", "Parent", "Sibling", "Child", "Friend"];

function phoneFromIndex(i: number): string {
  return `+91 97${String(20000000 + i * 53).slice(0, 8)}`;
}

export function generatePatients(rng: Rng, branches: Branch[], now: Date, count = 120): Patient[] {
  const patients: Patient[] = [];
  for (let i = 0; i < count; i++) {
    const gender: Gender = rng.bool(0.5) ? "male" : "female";
    const name = randomPersonName(rng, gender);
    const age = rng.weighted<number>([
      [rng.int(1, 12), 10],
      [rng.int(13, 25), 15],
      [rng.int(26, 45), 30],
      [rng.int(46, 65), 30],
      [rng.int(66, 88), 15],
    ]);
    const dob = new Date(now);
    dob.setFullYear(dob.getFullYear() - age);
    dob.setDate(rng.int(1, 28));
    const branch = branches[i % branches.length];
    const registered = rng.dateOffset(now, -365 * 4, -3);
    const allergies = rng.bool(0.3) ? rng.pickMany(ALLERGIES.filter((a) => a !== "None known"), rng.int(1, 2)) : [];
    const chronic = rng.bool(0.25) ? [rng.pick(CHRONIC_CONDITIONS.filter((c) => c !== "None"))] : [];

    patients.push({
      id: padId("PT", 10000 + i + 1),
      name,
      age,
      dob: dob.toISOString().slice(0, 10),
      gender,
      phone: phoneFromIndex(i),
      email: `${name.toLowerCase().replace(/\s+/g, ".")}${i}@mailbox.demo`,
      bloodGroup: rng.pick(BLOOD_GROUPS),
      address: `House No. ${rng.int(1, 400)}, Sector ${rng.int(8, 71)}, ${branch.city}`,
      city: branch.city,
      branchId: branch.id,
      status: rng.weighted([
        ["active", 88],
        ["inactive", 8],
        ["archived", 4],
      ]),
      allergies,
      chronicConditions: chronic,
      registeredDate: registered.toISOString().slice(0, 10),
      avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      emergencyContact: {
        name: `${randomPersonName(rng, rng.bool() ? "male" : "female").split(" ")[0]} ${rng.pick(LAST_NAMES)}`,
        phone: phoneFromIndex(i + 500),
        relation: rng.pick(RELATIONS),
      },
    });
  }
  return patients;
}

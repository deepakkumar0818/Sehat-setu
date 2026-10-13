import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { globalSearch } from "@/services/search";
import { getDb } from "@/store/data-store";

describe("global search", () => {
  beforeEach(resetDb);

  it("finds a patient by name and by ID", async () => {
    const patient = getDb().patients[0];
    const byName = await globalSearch(patient.name.split(" ")[0]);
    expect(byName.patients.some((p) => p.id === patient.id)).toBe(true);

    const byId = await globalSearch(patient.id);
    expect(byId.patients.some((p) => p.id === patient.id)).toBe(true);
  });

  it("finds a doctor by specialization", async () => {
    const doctor = getDb().doctors[0];
    const results = await globalSearch(doctor.specialization);
    expect(results.doctors.some((d) => d.id === doctor.id)).toBe(true);
  });

  it("returns empty groups for a blank query", async () => {
    const results = await globalSearch("   ");
    expect(results.patients).toEqual([]);
    expect(results.doctors).toEqual([]);
  });

  it("returns empty groups when nothing matches", async () => {
    const results = await globalSearch("zzzznonexistentqueryzzzz");
    expect(results.patients).toEqual([]);
    expect(results.invoices).toEqual([]);
  });
});

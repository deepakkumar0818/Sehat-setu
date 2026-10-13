import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { createPatient, listPatients } from "@/services/patients";

describe("patients service", () => {
  beforeEach(resetDb);

  it("creates a patient with a well-formed ID and sensible defaults", async () => {
    const patient = await createPatient({
      name: "Test Patient",
      age: 30,
      gender: "male",
      phone: "+91 9800000000",
      email: "test.patient@example.com",
      bloodGroup: "O+",
      address: "123 Test Street",
      city: "Chandigarh",
      branchId: "BR-01",
    });

    expect(patient.id).toMatch(/^PT-\d{5}$/);
    expect(patient.status).toBe("active");
    expect(patient.allergies).toEqual([]);
    expect(patient.registeredDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("makes a newly created patient discoverable via search", async () => {
    const created = await createPatient({
      name: "Zzyzx Searchable",
      age: 40,
      gender: "female",
      phone: "+91 9811111111",
      email: "zzyzx@example.com",
      bloodGroup: "A+",
      address: "Somewhere",
      city: "Mohali",
      branchId: "BR-02",
    });

    const result = await listPatients({ search: "Zzyzx" });
    expect(result.items.some((p) => p.id === created.id)).toBe(true);
  });

  it("filters patients by status", async () => {
    const result = await listPatients({ status: "archived", pageSize: 200 });
    expect(result.items.every((p) => p.status === "archived")).toBe(true);
  });
});

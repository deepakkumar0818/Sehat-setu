import { describe, expect, it } from "vitest";
import { DosageForm } from "@/generated/prisma/enums";
import { DOSAGE_FORM_VALUES, DOSAGE_FORMS, dosageFormLabel } from "@/lib/dosage-forms";
import { PERMISSION_CATALOG, ROLE_PERMISSION_DEFAULTS } from "@/data/permission-catalog";
import { createCatalogMedicineSchema, medicineStrengthKey, medicineTextKey, tidy } from "./medicine-rules";

describe("dosage forms", () => {
  it("lists all 13 forms, in step with the database enum", () => {
    expect(DOSAGE_FORMS).toHaveLength(13);
    expect(DOSAGE_FORM_VALUES.map((v) => v.toUpperCase())).toEqual(Object.values(DosageForm));
    for (const added of ["cream", "gel", "lotion", "suspension", "powder", "sachet"]) expect(DOSAGE_FORM_VALUES).toContain(added);
    expect(dosageFormLabel("suspension")).toBe("Suspension");
  });
});

describe("normalisation (mirrors app.medicine_text_key / app.medicine_strength_key)", () => {
  it("ignores case, outer spaces and repeated spaces in names", () => {
    expect(medicineTextKey("  Dolo   650 ")).toBe("dolo 650");
    expect(medicineTextKey("DOLO 650")).toBe(medicineTextKey("dolo\t650"));
    expect(medicineTextKey("Para cetamol")).not.toBe(medicineTextKey("Paracetamol")); // inner word breaks still matter in names
  });

  it("ignores all spacing and case in strengths", () => {
    expect(medicineStrengthKey("500 mg")).toBe("500mg");
    expect(medicineStrengthKey(" 500  MG ")).toBe(medicineStrengthKey("500mg"));
    expect(medicineStrengthKey("500 mg / 250 IU")).toBe("500mg/250iu");
    expect(medicineStrengthKey("500 mg")).not.toBe(medicineStrengthKey("0.5 g")); // unit conversion is out of scope
  });

  it("stores display values trimmed with collapsed spaces, case kept", () => {
    expect(tidy("  Dolo   650 ")).toBe("Dolo 650");
  });
});

describe("create input validation", () => {
  const ok = { name: "Dolo 650", genericName: "Paracetamol", strength: "650 mg", dosageForm: "tablet" };

  it("accepts the four required fields and tidies them", () => {
    expect(createCatalogMedicineSchema.parse({ ...ok, name: "  Dolo   650 " })).toMatchObject({ name: "Dolo 650", dosageForm: "tablet" });
    expect(createCatalogMedicineSchema.parse({ ...ok, dosageForm: "sachet", confirmGenericMatch: true }).confirmGenericMatch).toBe(true);
  });

  it.each([
    ["a missing generic name", { ...ok, genericName: undefined }],
    ["a one-letter name", { ...ok, name: " D " }],
    ["a blank strength", { ...ok, strength: "   " }],
    ["an overlong name", { ...ok, name: "x".repeat(121) }],
    ["an unknown dosage form", { ...ok, dosageForm: "spray" }],
    ["an upper-case dosage form", { ...ok, dosageForm: "TABLET" }],
    ["control characters", { ...ok, name: "Dolo\u0000650" }],
    ["unexpected fields (no manufacturer/schedule)", { ...ok, manufacturer: "X" }],
  ])("rejects %s", (_label, input) => {
    expect(createCatalogMedicineSchema.safeParse(input).success).toBe(false);
  });
});

describe("permission catalogue", () => {
  it("recognises medicine.catalog.create, granted by default to the administrator role only", () => {
    expect(PERMISSION_CATALOG.find((p) => p.key === "medicine.catalog.create")).toMatchObject({
      module: "pharmacy",
      name: "Add catalogue medicines",
      description: "Add a medicine to the shared catalogue used by every clinic.",
    });
    const holders = Object.entries(ROLE_PERMISSION_DEFAULTS).filter(([, keys]) => keys.includes("medicine.catalog.create")).map(([role]) => role);
    expect(holders).toEqual(["clinic_admin"]);
  });
});

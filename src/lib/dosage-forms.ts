// The medicine catalogue's dosage forms, as the API and UI use them (lower-case).
// Mirrors the database enum "DosageForm" (Prisma enum DosageForm); a unit test
// keeps the two in step. Order = the enum's order.
export const DOSAGE_FORMS = [
  { value: "tablet", label: "Tablet" },
  { value: "capsule", label: "Capsule" },
  { value: "syrup", label: "Syrup" },
  { value: "injection", label: "Injection" },
  { value: "ointment", label: "Ointment" },
  { value: "drops", label: "Drops" },
  { value: "inhaler", label: "Inhaler" },
  { value: "cream", label: "Cream" },
  { value: "gel", label: "Gel" },
  { value: "lotion", label: "Lotion" },
  { value: "suspension", label: "Suspension" },
  { value: "powder", label: "Powder" },
  { value: "sachet", label: "Sachet" },
] as const;

export type DosageFormValue = (typeof DOSAGE_FORMS)[number]["value"];

export const DOSAGE_FORM_VALUES = DOSAGE_FORMS.map((f) => f.value) as [DosageFormValue, ...DosageFormValue[]];

export const dosageFormLabel = (value: string) => DOSAGE_FORMS.find((f) => f.value === value)?.label ?? value;

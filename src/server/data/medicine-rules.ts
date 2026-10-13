// Pure rules for adding medicines to the shared catalogue. The normalisation
// mirrors the database's app.medicine_text_key() / app.medicine_strength_key()
// (migration 20261018000100); the database's unique index is the authority.
import { z } from "zod";
import { DOSAGE_FORM_VALUES } from "@/lib/dosage-forms";

/** Name / generic name key: lower-case, trimmed, runs of whitespace → one space. */
export const medicineTextKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Strength key: lower-case, all whitespace removed ("500 mg" = "500mg"). */
export const medicineStrengthKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** Display value as stored: trimmed, whitespace runs collapsed, case kept. */
export const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const field = (label: string, min: number, max: number) =>
  z
    .string()
    .refine((s) => !CONTROL.test(s.replace(/\s/g, " ")), `${label} contains invalid characters.`)
    .transform(tidy)
    .pipe(z.string().min(min, `${label} must be at least ${min} character${min === 1 ? "" : "s"}.`).max(max, `${label} must be at most ${max} characters.`));

export const createCatalogMedicineSchema = z
  .object({
    name: field("Medicine name", 2, 120),
    genericName: field("Generic name", 2, 200),
    strength: field("Strength", 1, 40),
    dosageForm: z.enum(DOSAGE_FORM_VALUES, { errorMap: () => ({ message: "Choose a dosage form." }) }),
    /** Set after the user has seen the same-generic warning and chosen to proceed. */
    confirmGenericMatch: z.boolean().optional(),
  })
  .strict();

export type CreateCatalogMedicineData = z.infer<typeof createCatalogMedicineSchema>;

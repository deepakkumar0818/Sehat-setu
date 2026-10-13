// Pure validation for clinical input, shared by the clinical data module and its
// tests. These are plausibility bounds to catch typing mistakes (e.g. 986 for
// 98.6 °F), not clinical reference ranges, and they never generate values.
import { z } from "zod";
import type { Vitals } from "@/types";

/** Inclusive bounds per measured vital. BMI is never accepted from the client; it's computed. */
export const VITAL_BOUNDS = {
  temperatureF: [80, 115],
  bpSystolic: [50, 260],
  bpDiastolic: [30, 160],
  heartRate: [20, 250],
  spo2: [50, 100],
  weightKg: [0.5, 400],
  heightCm: [30, 250],
} as const satisfies Record<Exclude<keyof Vitals, "bmi">, readonly [number, number]>;

type MeasuredVital = keyof typeof VITAL_BOUNDS;

const LABELS: Record<MeasuredVital, string> = {
  temperatureF: "Temperature (°F)",
  bpSystolic: "Systolic BP",
  bpDiastolic: "Diastolic BP",
  heartRate: "Heart rate",
  spo2: "SpO2",
  weightKg: "Weight",
  heightCm: "Height",
};

const vital = (key: MeasuredVital) => {
  const [min, max] = VITAL_BOUNDS[key];
  return z
    .number({ invalid_type_error: `${LABELS[key]} must be a number.` })
    .finite()
    .min(min, `${LABELS[key]} must be between ${min} and ${max}.`)
    .max(max, `${LABELS[key]} must be between ${min} and ${max}.`)
    .optional()
    .nullable();
};

/** Accepts only known vital keys; unknown keys (including a client-sent bmi) are dropped. */
export const vitalsSchema = z
  .object(Object.fromEntries((Object.keys(VITAL_BOUNDS) as MeasuredVital[]).map((k) => [k, vital(k)])) as Record<MeasuredVital, ReturnType<typeof vital>>)
  .refine((v) => v.bpSystolic == null || v.bpDiastolic == null || v.bpSystolic > v.bpDiastolic, { message: "Systolic BP must be higher than diastolic BP.", path: ["bpDiastolic"] });

/** Drops empty values so only actually measured vitals are stored. */
export function cleanVitals(v: z.infer<typeof vitalsSchema>): Partial<Record<MeasuredVital, number>> {
  return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number")) as Partial<Record<MeasuredVital, number>>;
}

export function computeBmi(weightKg?: number, heightCm?: number): number | undefined {
  if (!weightKg || !heightCm) return undefined;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}

/** Stored JSON → UI vitals, with BMI derived. Anything unexpected in the column is ignored. */
export function vitalsToUi(stored: unknown): Vitals {
  const parsed = vitalsSchema.safeParse(stored && typeof stored === "object" ? stored : {});
  const v = parsed.success ? cleanVitals(parsed.data) : {};
  const bmi = computeBmi(v.weightKg, v.heightCm);
  return { ...v, ...(bmi !== undefined ? { bmi } : {}) };
}

export const formatDuration = (days: number) => `${days} day${days === 1 ? "" : "s"}`;

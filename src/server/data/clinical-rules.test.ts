import { describe, expect, it } from "vitest";
import { cleanVitals, computeBmi, formatDuration, vitalsSchema, vitalsToUi } from "./clinical-rules";

describe("vitals validation", () => {
  it("accepts plausible measurements and drops empty ones", () => {
    const parsed = vitalsSchema.parse({ temperatureF: 98.6, bpSystolic: 120, bpDiastolic: 80, heartRate: 72, spo2: 98, weightKg: 70, heightCm: 175, bmi: 99 });
    expect(parsed).not.toHaveProperty("bmi"); // never accepted from the client
    expect(cleanVitals({ ...parsed, heartRate: null })).toEqual({ temperatureF: 98.6, bpSystolic: 120, bpDiastolic: 80, spo2: 98, weightKg: 70, heightCm: 175 });
  });

  it.each([
    [{ temperatureF: 986 }],
    [{ spo2: 101 }],
    [{ heartRate: 0 }],
    [{ weightKg: -1 }],
    [{ heightCm: 900 }],
    [{ bpSystolic: 80, bpDiastolic: 90 }],
    [{ temperatureF: "hot" }],
    [{ spo2: Number.POSITIVE_INFINITY }],
  ])("rejects implausible input %j", (input) => {
    expect(vitalsSchema.safeParse(input).success).toBe(false);
  });
});

describe("derived values", () => {
  it("computes BMI to one decimal, only when weight and height are both known", () => {
    expect(computeBmi(70, 175)).toBe(22.9);
    expect(computeBmi(70, undefined)).toBeUndefined();
  });

  it("maps stored vitals for the UI, ignoring anything unexpected", () => {
    expect(vitalsToUi({ weightKg: 70, heightCm: 175, injected: "<script>" })).toEqual({ weightKg: 70, heightCm: 175, bmi: 22.9 });
    expect(vitalsToUi(null)).toEqual({});
    expect(vitalsToUi({ spo2: 500 })).toEqual({}); // out-of-range stored data isn't shown as if valid
  });

  it("formats durations", () => {
    expect(formatDuration(1)).toBe("1 day");
    expect(formatDuration(5)).toBe("5 days");
  });
});

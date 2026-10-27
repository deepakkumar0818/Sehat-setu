import { describe, expect, it } from "vitest";
import { clock, DEFAULT_TIMINGS, describeWeek, slotTimesFor, weekdayOf } from "@/lib/clinic-hours";
import { acceptsMethod, clinicSettingsPatchSchema, DEFAULT_SETTINGS, toClinicSettings, toDbPatch } from "./clinic-settings-rules";

// Clinic settings: slots from the timings (mirrors app.is_clinic_slot in
// migration 20261102000000_clinic_settings) and what an administrator may save.

describe("slots from the clinic's timings", () => {
  it("defaults are the old fixed grid: Mon–Sat 09:00–16:30 every 30 min, no 13:00/13:30, closed Sunday", () => {
    const monday = slotTimesFor("2026-10-12", DEFAULT_TIMINGS);
    expect(monday).toHaveLength(14);
    expect(monday[0]).toBe("09:00");
    expect(monday.at(-1)).toBe("16:30");
    expect(monday).not.toContain("13:00");
    expect(monday).not.toContain("13:30");
    expect(slotTimesFor("2026-10-18", DEFAULT_TIMINGS)).toEqual([]);
    expect(weekdayOf("2026-10-18")).toBe("sun");
  });

  it("counts from opening time, ends by closing time and skips anything touching the break", () => {
    const t = { ...DEFAULT_TIMINGS, slotMinutes: 45 as const, breakStart: "12:30", breakEnd: "13:15", weeklyHours: { ...DEFAULT_TIMINGS.weeklyHours, mon: { open: "10:00", close: "14:30" } } };
    // Grid 10:00 + 45n: 12:15 and 13:00 overlap the 12:30–13:15 break; 13:45 ends exactly at closing.
    expect(slotTimesFor("2026-10-12", t)).toEqual(["10:00", "10:45", "11:30", "13:45"]);
  });

  it("describes the week compactly", () => {
    expect(describeWeek(DEFAULT_TIMINGS.weeklyHours)).toEqual(["Mon–Sat: 9:00 AM – 5:00 PM", "Sun: Closed"]);
    expect(clock("00:05")).toBe("12:05 AM");
    expect(clock("12:00")).toBe("12:00 PM");
  });
});

describe("what an administrator may save", () => {
  const parse = (v: unknown) => clinicSettingsPatchSchema.safeParse(v);

  it("timings: all seven days, valid hours, a whole break, an allowed slot length", () => {
    expect(parse({ weeklyHours: DEFAULT_TIMINGS.weeklyHours }).success).toBe(true);
    const sixDays = Object.fromEntries(Object.entries(DEFAULT_TIMINGS.weeklyHours).filter(([day]) => day !== "sun"));
    expect(parse({ weeklyHours: sixDays }).success).toBe(false);
    expect(parse({ weeklyHours: { ...DEFAULT_TIMINGS.weeklyHours, mon: { open: "17:00", close: "09:00" } } }).success).toBe(false);
    expect(parse({ weeklyHours: { ...DEFAULT_TIMINGS.weeklyHours, mon: { open: "09:02", close: "17:00" } } }).success).toBe(false);
    expect(parse({ breakStart: "13:00", breakEnd: "14:00" }).success).toBe(true);
    expect(parse({ breakStart: null, breakEnd: null }).success).toBe(true);
    expect(parse({ breakStart: "13:00" }).success).toBe(false);
    expect(parse({ breakStart: "13:00", breakEnd: null }).success).toBe(false);
    expect(parse({ breakStart: "14:00", breakEnd: "13:00" }).success).toBe(false);
    expect(parse({ slotMinutes: 15 }).success).toBe(true);
    expect(parse({ slotMinutes: 25 }).success).toBe(false);
  });

  it("booking rules stay within sensible limits", () => {
    expect(parse({ bookingMaxDaysAhead: 90, bookingMinNoticeMinutes: 120, bookingMaxUpcoming: 3 }).success).toBe(true);
    for (const bad of [{ bookingMaxDaysAhead: 0 }, { bookingMaxDaysAhead: 400 }, { bookingMinNoticeMinutes: -1 }, { bookingMaxUpcoming: 50 }, { bookingMaxUpcoming: 2.5 }]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("billing: prefix and GSTIN upper-cased, empty means none, tax 0–28%, at least one method", () => {
    expect(parse({ invoicePrefix: " aar/26-27/ ", gstin: "27abcde1234f1z5" }).data).toEqual({ invoicePrefix: "AAR/26-27/", gstin: "27ABCDE1234F1Z5" });
    expect(parse({ invoicePrefix: "", gstin: "" }).data).toEqual({ invoicePrefix: null, gstin: null });
    expect(parse({ invoicePrefix: "TOO-LONG-PREFIX-" }).success).toBe(false);
    expect(parse({ gstin: "27ABCDE1234F1Z" }).success).toBe(false);
    expect(parse({ defaultTaxPercent: 29 }).success).toBe(false);
    expect(parse({ paymentMethods: [] }).success).toBe(false);
    expect(parse({ paymentMethods: ["upi", "cash", "upi"] }).data).toEqual({ paymentMethods: ["cash", "upi"] });
    expect(parse({ paymentMethods: ["cheque"] }).success).toBe(false);
  });

  it("branding: raster logos only, a hex colour, a website with its scheme", () => {
    expect(parse({ logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }).success).toBe(true);
    expect(parse({ logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).success).toBe(false);
    expect(parse({ logoDataUrl: `data:image/png;base64,${"A".repeat(300_001)}` }).success).toBe(false);
    expect(parse({ brandColor: "#0F766E" }).data).toEqual({ brandColor: "#0f766e" });
    expect(parse({ brandColor: "teal" }).success).toBe(false);
    expect(parse({ website: "www.aarogya.in" }).data).toEqual({ website: "https://www.aarogya.in" });
    expect(parse({ website: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rejects unknown fields and empty patches", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ clinicId: "x" }).success).toBe(false);
  });
});

describe("storage mapping", () => {
  it("splits the clinic's brand colour from the settings row, and stores methods as database values", () => {
    expect(toDbPatch({ brandColor: "#112233", paymentMethods: ["cash", "bank_transfer"], slotMinutes: 20 })).toEqual({
      settings: { paymentMethods: ["CASH", "BANK_TRANSFER"], slotMinutes: 20 },
      clinic: { brandColor: "#112233" },
    });
  });

  it("a missing row reads as the defaults", () => {
    expect(toClinicSettings(null, "#abcdef")).toEqual({ ...DEFAULT_SETTINGS, brandColor: "#abcdef" });
    expect(acceptsMethod({ paymentMethods: ["cash"] }, "upi")).toBe(false);
    expect(acceptsMethod(DEFAULT_SETTINGS, "online")).toBe(true);
  });
});

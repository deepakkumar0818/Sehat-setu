import { describe, expect, it } from "vitest";
import {
  addDays,
  ageingBand,
  checkRange,
  csvCell,
  daysBetween,
  eachDay,
  eachMonth,
  isDateKey,
  istDateOf,
  istDayStart,
  MAX_RANGE_DAYS,
  noShowRate,
  paiseToRupeesText,
  presetRange,
  toCsv,
} from "./reports";

describe("report date ranges (IST calendar days)", () => {
  it("accepts only real yyyy-MM-dd dates", () => {
    for (const ok of ["2026-10-13", "2024-02-29", "2026-12-31"]) expect(isDateKey(ok), ok).toBe(true);
    for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "13-10-2026", "2026-1-5", "", "2026-10-13T00:00"]) expect(isDateKey(bad), bad).toBe(false);
  });

  it("an IST day starts at 18:30 UTC the previous day", () => {
    expect(istDayStart("2026-10-13").toISOString()).toBe("2026-10-12T18:30:00.000Z");
    expect(istDateOf(new Date("2026-10-12T18:29:59.999Z"))).toBe("2026-10-12");
    expect(istDateOf(new Date("2026-10-12T18:30:00.000Z"))).toBe("2026-10-13");
    // 23:59 IST on 31 Oct is still October; 00:00 IST on 1 Nov is November.
    expect(istDateOf(new Date("2026-10-31T18:29:00Z"))).toBe("2026-10-31");
    expect(istDateOf(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11-01");
  });

  it("a range covers both end days: [IST midnight of from, IST midnight after to)", () => {
    const r = checkRange("2026-10-01", "2026-10-31");
    expect(r).toMatchObject({ ok: true, days: 31 });
    if (r.ok) {
      expect(r.start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
      expect(r.end.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    }
    expect(checkRange("2026-10-13", "2026-10-13")).toMatchObject({ ok: true, days: 1 });
  });

  it("rejects reversed, oversized, out-of-bounds and malformed ranges with a clear message", () => {
    expect(checkRange("2026-10-14", "2026-10-13")).toEqual({ ok: false, error: "The start date must be on or before the end date." });
    expect(checkRange("2025-01-01", "2026-01-02")).toEqual({ ok: false, error: `Choose a range of at most ${MAX_RANGE_DAYS} days.` });
    expect(checkRange("2025-01-01", "2026-01-01").ok).toBe(true); // 366 days (inclusive) is allowed
    expect(checkRange("1999-12-31", "2000-01-10").ok).toBe(false);
    expect(checkRange("2026-02-30", "2026-03-01")).toEqual({ ok: false, error: "Enter dates as YYYY-MM-DD." });
  });

  it("date arithmetic crosses months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(eachDay({ from: "2026-02-27", to: "2026-03-02" })).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(eachMonth({ from: "2025-11-15", to: "2026-02-01" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("presets end today (IST) and 'last month' is the whole previous calendar month", () => {
    expect(presetRange("last7", "2026-10-13")).toEqual({ from: "2026-10-07", to: "2026-10-13" });
    expect(presetRange("last30", "2026-10-13")).toEqual({ from: "2026-09-14", to: "2026-10-13" });
    expect(presetRange("thisMonth", "2026-10-13")).toEqual({ from: "2026-10-01", to: "2026-10-13" });
    expect(presetRange("lastMonth", "2026-10-13")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("lastMonth", "2024-03-31")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("report calculations", () => {
  it("ageing bands match the documented boundaries", () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(ageingBand)).toEqual(["current", "current", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90_plus", "d90_plus"]);
  });

  it("no-show rate = no-shows ÷ (completed + no-shows); undefined when nothing reached an outcome", () => {
    expect(noShowRate(3, 1)).toBe(0.25);
    expect(noShowRate(0, 2)).toBe(1);
    expect(noShowRate(0, 0)).toBeNull();
  });

  it("formats paise as exact rupees (no floating-point drift)", () => {
    expect(paiseToRupeesText(0)).toBe("0.00");
    expect(paiseToRupeesText(5)).toBe("0.05");
    expect(paiseToRupeesText(123456789)).toBe("1234567.89");
    expect(paiseToRupeesText(-150)).toBe("-1.50");
  });
});

describe("CSV output", () => {
  it("neutralises spreadsheet formulas in text cells", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell("Dr. Asha Rao")).toBe("Dr. Asha Rao");
    // Numbers stay numbers (a negative number is not a formula).
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell('Rao, "Asha"')).toBe('"Rao, ""Asha"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("=a,b")).toBe("\"'=a,b\"");
  });

  it("writes a BOM, a header and CRLF rows", () => {
    expect(toCsv(["Date", "Total"], [["2026-10-13", 4], ["2026-10-14", 0]])).toBe("\uFEFFDate,Total\r\n2026-10-13,4\r\n2026-10-14,0\r\n");
  });
});

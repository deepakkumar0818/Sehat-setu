import { describe, expect, it } from "vitest";
import { formatPhone, parsePhone, phoneFromParts, phoneParts, phoneSchema, phoneSearchTerms, PHONE_COUNTRIES } from "./phone";

describe("phone numbers (country code + number → E.164)", () => {
  it("India by default: 10 digits, spaces/dashes and a trunk 0 are fine", () => {
    for (const n of ["9876543210", "98765 43210", "98765-43210", "098765 43210", "(98765) 43210", "2041234567"]) {
      expect(phoneFromParts("91", n), n).toEqual({ ok: true, e164: n.startsWith("20") ? "+912041234567" : "+919876543210" });
    }
  });

  it("refuses invalid Indian numbers with a clear message (never the number itself)", () => {
    for (const n of ["98765 4321", "98765 432100", "12345 67890", "00000 10000", "98765 4321x", "abc"]) {
      const r = phoneFromParts("91", n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toMatch(/\d{4,}/);
        expect(r.error.length).toBeGreaterThan(10);
      }
    }
    expect(phoneFromParts("91", "")).toEqual({ ok: false, error: "Enter a phone number." });
  });

  it("other listed countries use their own length rules", () => {
    expect(phoneFromParts("1", "(415) 555-2671")).toEqual({ ok: true, e164: "+14155552671" });
    expect(phoneFromParts("1", "555 0100").ok).toBe(false);
    expect(phoneFromParts("44", "07911 123456")).toEqual({ ok: true, e164: "+447911123456" });
    expect(phoneFromParts("971", "050 123 4567")).toEqual({ ok: true, e164: "+971501234567" });
    expect(phoneFromParts("65", "9123 4567")).toEqual({ ok: true, e164: "+6591234567" });
    expect(phoneFromParts("65", "1123 4567").ok).toBe(false);
  });

  it("any other country code: E.164 rules (code 1–3 digits, at most 15 digits in all)", () => {
    expect(phoneFromParts("+351", "912 345 678")).toEqual({ ok: true, e164: "+351912345678" });
    expect(phoneFromParts("", "912 345 678").ok).toBe(false);
    expect(phoneFromParts("0", "912 345 678").ok).toBe(false);
    expect(phoneFromParts("351", "12").ok).toBe(false);
    expect(phoneFromParts("351", "1234567890123456").ok).toBe(false);
  });

  it("a full international number typed into the number field wins over the picker", () => {
    expect(phoneFromParts("1", "+91 98765 43210")).toEqual({ ok: true, e164: "+919876543210" });
    expect(phoneFromParts("91", "0044 7911 123456")).toEqual({ ok: true, e164: "+447911123456" });
  });

  it("parsePhone (server): accepts any spelling of an international number, requires the country code", () => {
    expect(parsePhone("+91 98765 43210")).toEqual({ ok: true, e164: "+919876543210" });
    expect(parsePhone("+919876543210")).toEqual({ ok: true, e164: "+919876543210" });
    expect(parsePhone("+351 912 345 678")).toEqual({ ok: true, e164: "+351912345678" });
    expect(parsePhone("9876543210").ok).toBe(false);
    expect(parsePhone("+91 18000 00001").ok).toBe(false);
    expect(parsePhone("+0 123 4567").ok).toBe(false);
    expect(parsePhone("+12345678901234567").ok).toBe(false);
  });

  it("formats E.164 for display and leaves anything else as stored", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+14155552671")).toBe("+1 415 555 2671");
    expect(formatPhone("+91 00000 10000")).toBe("+91 00000 10000"); // seed data, unchanged
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });

  it("phoneParts splits a stored number back into the picker's fields (round-trips with phoneFromParts)", () => {
    expect(phoneParts("+919876543210")).toEqual({ country: "IN", otherDial: "", national: "9876543210" });
    // A number stored as typed (older self-registrations) still loads into the form.
    expect(phoneParts("+91 98765 43210")).toEqual({ country: "IN", otherDial: "", national: "9876543210" });
    expect(phoneParts("+91 (98765) 43-210")).toEqual({ country: "IN", otherDial: "", national: "9876543210" });
    expect(phoneParts("+447911123456")).toEqual({ country: "GB", otherDial: "", national: "7911123456" });
    for (const stored of ["+919876543210", "+14155552671", "+971501234567"]) {
      const p = phoneParts(stored);
      const dial = PHONE_COUNTRIES.find((c) => c.iso === p.country)!.dial;
      expect(phoneFromParts(dial, p.national)).toEqual({ ok: true, e164: stored });
    }
    // Seed values, unknown codes and empty values start empty (India selected).
    for (const stored of ["+91 00000 10000", "+351912345678", "", null]) expect(phoneParts(stored)).toEqual({ country: "IN", otherDial: "", national: "" });
  });

  it("phoneSchema (API): E.164 out, errors never contain the number", () => {
    expect(phoneSchema.parse("+91 98765-43210")).toBe("+919876543210");
    const r = phoneSchema.safeParse("98765 43210");
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain("98765");
  });

  it("phoneSearchTerms: typed numbers match E.164 storage; non-phone searches add nothing", () => {
    expect(phoneSearchTerms("98765 43210")).toEqual(["9876543210"]);
    expect(phoneSearchTerms("098765-43210")).toEqual(["09876543210", "9876543210"]);
    expect(phoneSearchTerms("+91 98765 43210")).toEqual(["919876543210"]);
    expect(phoneSearchTerms("(415) 555-2671")).toEqual(["4155552671"]);
    for (const s of ["Rahul", "rahul@example.com", "123", "98a76", ""]) expect(phoneSearchTerms(s), s).toEqual([]);
    // Every term is a substring of the stored E.164 number.
    for (const s of ["98765 43210", "098765-43210", "+91 98765 43210", "43210"]) {
      expect(phoneSearchTerms(s).some((t) => "+919876543210".includes(t)), s).toBe(true);
    }
  });

  it("every listed country has a unique ISO code and a sane length range", () => {
    expect(new Set(PHONE_COUNTRIES.map((c) => c.iso)).size).toBe(PHONE_COUNTRIES.length);
    for (const c of PHONE_COUNTRIES) expect(c.min <= c.max && c.dial.length + c.max <= 15, c.iso).toBe(true);
    expect(PHONE_COUNTRIES[0]).toMatchObject({ iso: "IN", dial: "91" });
  });
});

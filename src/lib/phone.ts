import { z } from "zod";

// Phone numbers for staff invitations: entered as a country code + national
// number, stored in E.164 form ("+919876543210"), shown grouped ("+91 98765 43210").
// Pure module, shared by the invite dialog (inline errors) and the server
// (validation). Error messages never repeat the number itself.

export interface PhoneCountry {
  /** ISO 3166 code (unique key for the picker). */
  iso: string;
  name: string;
  /** Dial code without "+". */
  dial: string;
  /** Allowed national-number lengths (digits, without the trunk "0"). */
  min: number;
  max: number;
  /** Optional stricter shape of the national number. */
  pattern?: RegExp;
}

export const DEFAULT_PHONE_COUNTRY = "IN";
/** Picker value for a country code that isn't in the list. */
export const OTHER_COUNTRY = "OTHER";

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "IN", name: "India", dial: "91", min: 10, max: 10, pattern: /^[2-9]\d{9}$/ },
  { iso: "AE", name: "United Arab Emirates", dial: "971", min: 8, max: 9, pattern: /^[1-9]\d+$/ },
  { iso: "SA", name: "Saudi Arabia", dial: "966", min: 8, max: 9, pattern: /^[1-9]\d+$/ },
  { iso: "QA", name: "Qatar", dial: "974", min: 8, max: 8 },
  { iso: "KW", name: "Kuwait", dial: "965", min: 8, max: 8 },
  { iso: "OM", name: "Oman", dial: "968", min: 8, max: 8 },
  { iso: "BH", name: "Bahrain", dial: "973", min: 8, max: 8 },
  { iso: "NP", name: "Nepal", dial: "977", min: 8, max: 10 },
  { iso: "BD", name: "Bangladesh", dial: "880", min: 8, max: 10 },
  { iso: "LK", name: "Sri Lanka", dial: "94", min: 9, max: 9 },
  { iso: "PK", name: "Pakistan", dial: "92", min: 9, max: 10 },
  { iso: "SG", name: "Singapore", dial: "65", min: 8, max: 8, pattern: /^[3689]\d{7}$/ },
  { iso: "MY", name: "Malaysia", dial: "60", min: 8, max: 10 },
  { iso: "US", name: "United States / Canada", dial: "1", min: 10, max: 10, pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { iso: "GB", name: "United Kingdom", dial: "44", min: 9, max: 10, pattern: /^[1-9]\d+$/ },
  { iso: "AU", name: "Australia", dial: "61", min: 9, max: 9, pattern: /^[2-478]\d{8}$/ },
  { iso: "NZ", name: "New Zealand", dial: "64", min: 8, max: 10 },
  { iso: "DE", name: "Germany", dial: "49", min: 6, max: 13 },
  { iso: "FR", name: "France", dial: "33", min: 9, max: 9, pattern: /^[1-9]\d{8}$/ },
  { iso: "KE", name: "Kenya", dial: "254", min: 9, max: 9 },
  { iso: "ZA", name: "South Africa", dial: "27", min: 9, max: 9 },
];

/** E.164: "+", a country code not starting with 0, at most 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

const digitsOnly = (s: string) => s.replace(/[\s\-().]/g, "");

/** The listed country whose dial code prefixes these digits (longest match), if any. */
function countryForDigits(digits: string): PhoneCountry | undefined {
  return [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => digits.startsWith(c.dial));
}

function countryLabel(c: PhoneCountry) {
  const len = c.min === c.max ? `${c.min} digits` : `${c.min}–${c.max} digits`;
  return `Enter a valid ${c.name} (+${c.dial}) phone number: ${len}, without the leading 0.`;
}

function check(dial: string, national: string): PhoneResult {
  const country = PHONE_COUNTRIES.find((c) => c.dial === dial);
  // "+1" is shared by the US and Canada; other shared codes fall back to the generic rule.
  if (country) {
    const okLength = national.length >= country.min && national.length <= country.max;
    if (!okLength || (country.pattern && !country.pattern.test(national))) return { ok: false, error: countryLabel(country) };
  } else if (!/^[1-9]\d{0,2}$/.test(dial) || national.length < 4 || national.length > 14) {
    return { ok: false, error: "Enter a valid phone number with its country code (up to 15 digits in all)." };
  }
  const e164 = `+${dial}${national}`;
  return E164.test(e164) ? { ok: true, e164 } : { ok: false, error: "Enter a valid phone number with its country code (up to 15 digits in all)." };
}

/**
 * From the dialog's two fields. `national` may also be a full international
 * number ("+91 98765 43210" or "0091…"), which then wins over the picker.
 */
export function phoneFromParts(dial: string, national: string): PhoneResult {
  const raw = digitsOnly(national.trim());
  if (!raw) return { ok: false, error: "Enter a phone number." };
  if (raw.startsWith("+") || raw.startsWith("00")) return parsePhone(raw);
  if (!/^\d+$/.test(raw)) return { ok: false, error: "Use digits only (spaces and dashes are fine)." };
  const code = digitsOnly(dial).replace(/^\+/, "");
  if (!/^\d{1,3}$/.test(code)) return { ok: false, error: "Enter the country code (1–3 digits)." };
  // A single trunk "0" (e.g. "098765 43210" in India) isn't part of the international number.
  return check(code, raw.replace(/^0/, ""));
}

/** Any accepted spelling of an international number → E.164 (used by the server). */
export function parsePhone(value: string): PhoneResult {
  const raw = digitsOnly((value ?? "").trim());
  if (!raw) return { ok: false, error: "Enter a phone number." };
  const intl = raw.startsWith("+") ? raw.slice(1) : raw.startsWith("00") ? raw.slice(2) : null;
  if (intl === null || !/^\d+$/.test(intl)) return { ok: false, error: "Include the country code (for India, +91)." };
  const country = countryForDigits(intl);
  if (country) return check(country.dial, intl.slice(country.dial.length));
  return E164.test(`+${intl}`) ? { ok: true, e164: `+${intl}` } : { ok: false, error: "Enter a valid phone number with its country code (up to 15 digits in all)." };
}

/**
 * API field: any spelling of an international number in, E.164 out. Used by
 * staff invitations and the Staff directory's Edit phone. The message never
 * repeats the number.
 */
export const phoneSchema = z
  .string({ required_error: "Enter a phone number." })
  .max(40, "Enter a valid phone number with its country code.")
  .transform((s, ctx) => {
    const r = parsePhone(s);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
      return z.NEVER;
    }
    return r.e164;
  });

/**
 * Extra "contains" terms so a typed number finds a stored one: "98765 43210",
 * "098765-43210" and "+91 98765 43210" all find "+919876543210". Only for
 * phone-like searches with at least 4 digits; [] otherwise.
 */
export function phoneSearchTerms(search: string): string[] {
  const s = search.trim();
  if (!/^[\d\s()+\-.]+$/.test(s)) return [];
  const digits = s.replace(/\D/g, "");
  const terms = [digits, digits.replace(/^0+/, "")].filter((t) => t.length >= 4);
  return [...new Set(terms)];
}

/** Splits a stored number back into the picker's fields (for editing). Unknown or non-E.164 values start empty. */
export function phoneParts(stored: string | null | undefined): { country: string; otherDial: string; national: string } {
  const empty = { country: DEFAULT_PHONE_COUNTRY, otherDial: "", national: "" };
  if (!stored || !E164.test(stored)) return empty;
  const digits = stored.slice(1);
  const country = countryForDigits(digits);
  if (country) return { country: country.iso, otherDial: "", national: digits.slice(country.dial.length) };
  return empty;
}

/** For display: "+919876543210" → "+91 98765 43210". Anything not in E.164 form is shown as stored. */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!E164.test(stored)) return stored;
  const digits = stored.slice(1);
  const country = countryForDigits(digits);
  if (!country) return stored;
  const national = digits.slice(country.dial.length);
  const grouped =
    country.iso === "IN" && national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}`
    : country.iso === "US" && national.length === 10 ? `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
    : national.replace(/(\d{3,4})(?=\d{3,})/g, "$1 ");
  return `+${country.dial} ${grouped}`;
}

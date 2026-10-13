// Clinic reports (P6.1): date ranges, labels and CSV output shared by the
// server (src/server/data/reports.ts) and the reports page. Pure module.
//
// Calculation rules (also shown on the page):
// - Dates are IST calendar days. A range "from..to" is inclusive of both days:
//   [IST midnight of `from`, IST midnight of the day after `to`).
// - Appointments are counted by their scheduled start (startsAt).
// - New patients are counted by the day their record was created in Sehat Setu.
// - Collected (net) = SUCCEEDED payments whose payment date (paidAt) is in the range.
//   A payment is counted once, on its own date; invoice value is never treated as revenue.
// - Refunded = payments now REFUNDED whose ORIGINAL payment date is in the range
//   (the database records no separate refund date). Gross = net + refunded.
// - Billed = total of non-void invoices issued in the range (shown separately; not revenue).
// - Outstanding (as of today, not limited by the range) = for each PENDING or
//   PARTIALLY_PAID invoice, max(0, total − all SUCCEEDED payments). VOID invoices owe nothing.
// - Ageing is by due date (or the IST issue date when there is none): not yet due,
//   1–30, 31–60, 61–90 and over 90 days overdue.
// - No-show rate = no-shows ÷ (completed + no-shows); cancelled and still-open
//   appointments are excluded. Shown as "—" when nothing has reached an outcome.
// - Profit isn't reported: expenses aren't recorded in the clinic database.

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written yyyy-MM-dd (rejects 2026-02-30). */
export function isDateKey(value: string): boolean {
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The date `days` after a yyyy-MM-dd date (negative for before). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (0 when equal). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** First instant of an IST calendar day. */
export function istDayStart(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - IST_OFFSET_MS);
}

/** The IST calendar day (yyyy-MM-dd) containing an instant. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
}

export type RangeCheck = { ok: true; range: DateRange; start: Date; end: Date; days: number } | { ok: false; error: string };

/** Validates an inclusive IST date range; returns the [start, end) instants. */
export function checkRange(from: string, to: string): RangeCheck {
  if (!isDateKey(from) || !isDateKey(to)) return { ok: false, error: "Enter dates as YYYY-MM-DD." };
  if (from < "2000-01-01" || to > "2100-12-31") return { ok: false, error: "Choose dates between 2000 and 2100." };
  const span = daysBetween(from, to);
  if (span < 0) return { ok: false, error: "The start date must be on or before the end date." };
  if (span + 1 > MAX_RANGE_DAYS) return { ok: false, error: `Choose a range of at most ${MAX_RANGE_DAYS} days.` };
  return { ok: true, range: { from, to }, start: istDayStart(from), end: istDayStart(addDays(to, 1)), days: span + 1 };
}

export type RangePreset = "last7" | "last30" | "thisMonth" | "lastMonth" | "last90";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last90", label: "Last 90 days" },
];

/** A preset range ending today (IST), computed from `today` (yyyy-MM-dd). */
export function presetRange(preset: RangePreset, today: string): DateRange {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisMonth":
      return { from: monthStart, to: today };
    case "lastMonth": {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
  }
}

/** Every date from `from` to `to`, inclusive (so trends show days with nothing as zero). */
export function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Every month (yyyy-MM) the range touches. */
export function eachMonth(range: DateRange): string[] {
  const out: string[] = [];
  let m = range.from.slice(0, 7);
  const last = range.to.slice(0, 7);
  while (m <= last) {
    out.push(m);
    const [y, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  }
  return out;
}

export type AgeingBand = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGEING_BANDS: { key: AgeingBand; label: string }[] = [
  { key: "current", label: "Not yet due" },
  { key: "d1_30", label: "1–30 days overdue" },
  { key: "d31_60", label: "31–60 days overdue" },
  { key: "d61_90", label: "61–90 days overdue" },
  { key: "d90_plus", label: "Over 90 days overdue" },
];

/** The band for a balance `daysOverdue` days past its due date (0 or less = not yet due). Mirrors the SQL in reports.ts. */
export function ageingBand(daysOverdue: number): AgeingBand {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/** No-shows ÷ (completed + no-shows), as a fraction; null when nothing has reached an outcome. */
export function noShowRate(completed: number, noShow: number): number | null {
  const decided = completed + noShow;
  return decided > 0 ? noShow / decided : null;
}

// --- CSV ------------------------------------------------------------------------

export type CsvCell = string | number | null;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with
 * = + - @, tab or carriage return) is prefixed with an apostrophe; numbers are
 * written as numbers. Quotes, commas and line breaks are quoted per RFC 4180.
 */
export function csvCell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV document (CRLF line ends, UTF-8 byte-order mark so spreadsheets read ₹ and Indic names correctly). */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Paise → rupees with two decimals, for CSV (exact: integer arithmetic, no floating-point rounding). */
export function paiseToRupeesText(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export const REPORT_EXPORTS = [
  { key: "appointments", label: "Appointments by day", section: "appointments" },
  { key: "doctor_workload", label: "Doctor workload", section: "workload" },
  { key: "patient_registrations", label: "New patients by day", section: "patients" },
  { key: "collections", label: "Collections by day", section: "financial" },
  { key: "payment_methods", label: "Payment methods", section: "financial" },
  { key: "outstanding_ageing", label: "Outstanding by age", section: "financial" },
] as const;

export type ReportExportKey = (typeof REPORT_EXPORTS)[number]["key"];

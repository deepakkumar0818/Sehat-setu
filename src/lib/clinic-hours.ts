// Clinic timings → appointment slots. Pure, shared by the server (free slots
// for staff and patients) and the Settings page preview. Mirrors
// app.is_clinic_slot in migration 20261102000000_clinic_settings: slots start
// at opening time every slotMinutes, end by closing time and stay clear of the
// break. Dates are IST calendar dates ("YYYY-MM-DD"), times "HH:MM".
import type { ClinicTimings, Weekday, WeeklyHours } from "./live-types";

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABELS: Record<Weekday, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60] as const;

const STANDARD_DAY = { open: "09:00", close: "17:00" };

/** The rules built in before clinics could change them: Mon–Sat 09:00–17:00, lunch 13:00–14:00, 30-minute slots. */
export const DEFAULT_TIMINGS: ClinicTimings = {
  weeklyHours: { mon: STANDARD_DAY, tue: STANDARD_DAY, wed: STANDARD_DAY, thu: STANDARD_DAY, fri: STANDARD_DAY, sat: STANDARD_DAY, sun: null },
  breakStart: "13:00",
  breakEnd: "14:00",
  slotMinutes: 30,
};

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Weekday of an IST calendar date. */
export function weekdayOf(dateIso: string): Weekday {
  return WEEKDAYS[(new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/** Start times of the clinic's slots on a date (none on a closed day). */
export function slotTimesFor(dateIso: string, t: ClinicTimings): string[] {
  const day = t.weeklyHours[weekdayOf(dateIso)];
  if (!day) return [];
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  const brk = t.breakStart && t.breakEnd ? [toMinutes(t.breakStart), toMinutes(t.breakEnd)] : null;
  const slots: string[] = [];
  for (let m = open; m + t.slotMinutes <= close; m += t.slotMinutes) {
    if (brk && m < brk[1] && m + t.slotMinutes > brk[0]) continue;
    slots.push(fromMinutes(m));
  }
  return slots;
}

/** "Mon–Sat 9:00 AM – 5:00 PM", one line per group of days with the same hours. */
export function describeWeek(hours: WeeklyHours): string[] {
  const label = (d: { open: string; close: string } | null) => (d ? `${clock(d.open)} – ${clock(d.close)}` : "Closed");
  const groups: { from: Weekday; to: Weekday; text: string }[] = [];
  for (const day of WEEKDAYS) {
    const text = label(hours[day]);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = day;
    else groups.push({ from: day, to: day, text });
  }
  const short = (d: Weekday) => WEEKDAY_LABELS[d].slice(0, 3);
  return groups.map((g) => `${g.from === g.to ? short(g.from) : `${short(g.from)}–${short(g.to)}`}: ${g.text}`);
}

/** A clinic's hours on one line for the public pages ("Mon–Sat: 9:00 AM – 5:00 PM · Sun: Closed"); the defaults when unknown. */
export function hoursLine(hours: WeeklyHours | null | undefined): string {
  return describeWeek(hours ?? DEFAULT_TIMINGS.weeklyHours).join(" · ");
}

/** "13:30" → "1:30 PM". */
export function clock(hhmm: string): string {
  const m = toMinutes(hhmm);
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

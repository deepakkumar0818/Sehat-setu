// India Standard Time helpers (UTC+05:30, no DST). Clinic days are IST days,
// independent of the server's timezone.

const IST_OFFSET_MS = 330 * 60 * 1000;

function istParts(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(), h: shifted.getUTCHours(), min: shifted.getUTCMinutes() };
}

/** [start, end) instants of the IST calendar day `dayOffset` days from `now`. */
export function istDayRange(now: Date, dayOffset = 0): { start: Date; end: Date } {
  const p = istParts(now);
  const start = new Date(Date.UTC(p.y, p.m, p.d + dayOffset) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** First instant of the IST calendar month containing `now`. */
export function istMonthStart(now: Date): Date {
  const p = istParts(now);
  return new Date(Date.UTC(p.y, p.m, 1) - IST_OFFSET_MS);
}

/** IST date (yyyy-MM-dd) and time (HH:mm) of an instant. */
export function istDayKey(d: Date): { date: string; time: string } {
  const p = istParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.min)}` };
}

export const istTodayKey = (now: Date) => istDayKey(now).date;

export function istGreeting(now: Date): string {
  const h = istParts(now).h;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

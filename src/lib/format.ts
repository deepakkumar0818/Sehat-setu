import { format, formatDistance, isSameDay, parseISO, subDays } from "date-fns";
import { DEMO_NOW } from "@/lib/demo-clock";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { notation: "compact" }).format(value);
}

export function formatDate(iso: string, pattern = "dd MMM yyyy"): string {
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), "dd MMM yyyy · hh:mm a");
  } catch {
    return iso;
  }
}

// Compares against the demo's anchored "now" (see lib/demo-clock.ts) rather
// than the real system clock, so seeded data always reads as current
// regardless of when the prototype is actually opened.
export function formatFriendlyDate(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isSameDay(d, DEMO_NOW)) return "Today";
    if (isSameDay(d, subDays(DEMO_NOW, 1))) return "Yesterday";
    return format(d, "dd MMM yyyy");
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso: string): string {
  try {
    return formatDistance(parseISO(iso), DEMO_NOW, { addSuffix: true });
  } catch {
    return iso;
  }
}

/** Like formatRelativeTime, but against the real clock: for live clinic data, not the demo. */
export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  try {
    return formatDistance(parseISO(iso), now, { addSuffix: true });
  } catch {
    return iso;
  }
}

export function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// The demo is anchored to a fixed "now" so seeded today/upcoming/waiting-room
// data always lines up with what the UI considers "today", regardless of the
// real date the prototype happens to be opened on.
export const DEMO_NOW = new Date(2026, 8, 5, 11, 45, 0);

export function todayDateStr(): string {
  return DEMO_NOW.toISOString().slice(0, 10);
}

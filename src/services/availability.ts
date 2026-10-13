import { delay } from "@/lib/async";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import { getDb } from "@/store/data-store";
import type { Doctor, DoctorAvailabilitySlot } from "@/types";

const DAY_LABELS: DoctorAvailabilitySlot["day"][] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** All bookable slots for a doctor on a given date, respecting their weekly hours and 30-minute increments. */
function slotsForDay(doctor: Doctor, dateIso: string): string[] {
  const date = new Date(`${dateIso}T00:00:00`);
  const dayLabel = DAY_LABELS[date.getDay()];
  const window = doctor.availability.find((a) => a.day === dayLabel);
  if (!window) return [];

  const start = timeToMinutes(window.start);
  const end = timeToMinutes(window.end);
  const slots: string[] = [];
  for (let m = start; m < end; m += 30) {
    if (m >= 13 * 60 && m < 14 * 60) continue; // lunch break, matches seeded scheduling
    slots.push(minutesToTime(m));
  }
  return slots;
}

/** Slots not already occupied by an active (non-cancelled/no-show) appointment for this doctor. */
export async function getAvailableSlotsForDoctor(doctorId: string, dateIso: string): Promise<string[]> {
  await delay(300);
  const db = getDb();
  const doctor = db.doctors.find((d) => d.id === doctorId);
  if (!doctor) return [];

  const isPastToday = dateIso === todayDateStr();
  const nowMinutes = DEMO_NOW.getHours() * 60 + DEMO_NOW.getMinutes();

  const taken = new Set(
    db.appointments
      .filter((a) => a.doctorId === doctorId && a.date === dateIso && !["cancelled", "no_show"].includes(a.status))
      .map((a) => a.time)
  );

  return slotsForDay(doctor, dateIso).filter((time) => {
    if (taken.has(time)) return false;
    if (isPastToday && timeToMinutes(time) <= nowMinutes) return false;
    return true;
  });
}

/** The soonest open slot for a doctor, searching today through the next 14 days. Used for "Next available" labels. */
export async function getNextAvailableSlot(doctorId: string): Promise<{ date: string; time: string } | undefined> {
  await delay(200);
  const db = getDb();
  const doctor = db.doctors.find((d) => d.id === doctorId);
  if (!doctor || doctor.status !== "active") return undefined;

  for (let offset = 0; offset <= 14; offset++) {
    const date = new Date(DEMO_NOW);
    date.setDate(date.getDate() + offset);
    const dateIso = date.toISOString().slice(0, 10);
    const slots = await getAvailableSlotsForDoctor(doctorId, dateIso);
    if (slots.length > 0) return { date: dateIso, time: slots[0] };
  }
  return undefined;
}

/** Bulk variant for rendering many doctor cards without N sequential round-trips. */
export async function getNextAvailableSlots(doctorIds: string[]): Promise<Record<string, { date: string; time: string } | undefined>> {
  const results = await Promise.all(doctorIds.map((id) => getNextAvailableSlot(id)));
  return Object.fromEntries(doctorIds.map((id, i) => [id, results[i]]));
}

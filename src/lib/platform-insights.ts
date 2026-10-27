// What needs the super admin's attention in each clinic, worked out from the
// clinics overview (no extra queries). Pure: shared by the console and tests.
import type { PlatformClinic } from "@/lib/live-types";

export type AlertTone = "danger" | "warning" | "info";
/** What the button next to an alert does on the clinic's page. */
export type AlertAction = "admin" | "payment" | "plan" | "open";

export interface ClinicAlert {
  key: "no_admin" | "admin_invited" | "overdue" | "trial_ending" | "due_soon" | "at_limit" | "quiet" | "no_plan";
  tone: AlertTone;
  text: string;
  action: AlertAction;
  actionLabel: string;
}

export const TRIAL_ENDING_DAYS = 7;
export const QUIET_DAYS = 14;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The clinic's problems, most urgent first. Suspended clinics only report a missing administrator. */
export function clinicAlerts(c: PlatformClinic, now: Date = new Date()): ClinicAlert[] {
  const alerts: ClinicAlert[] = [];
  if (c.admins.length === 0) {
    alerts.push({ key: "no_admin", tone: "danger", text: "No administrator: nobody can manage this clinic", action: "admin", actionLabel: "Add administrator" });
  } else if (c.admins.every((a) => a.status === "invited")) {
    alerts.push({ key: "admin_invited", tone: "warning", text: "The administrator hasn't signed in yet", action: "open", actionLabel: "Resend invitation" });
  }
  if (c.status !== "active") return alerts;

  const s = c.subscription;
  if (!s) {
    alerts.push({ key: "no_plan", tone: "info", text: "Not on any plan (no limits, nothing billed)", action: "plan", actionLabel: "Choose plan" });
  } else if (s.state === "overdue") {
    alerts.push({ key: "overdue", tone: "danger", text: `${s.planKey === "TRIAL" ? "Free trial ended" : "Payment overdue"} ${days(-s.daysLeft)} ago`, action: s.planKey === "TRIAL" ? "plan" : "payment", actionLabel: s.planKey === "TRIAL" ? "Choose plan" : "Record payment" });
  } else if (s.state === "trial" && s.daysLeft <= TRIAL_ENDING_DAYS) {
    alerts.push({ key: "trial_ending", tone: "warning", text: s.daysLeft === 0 ? "Free trial ends today" : `Free trial ends in ${days(s.daysLeft)}`, action: "plan", actionLabel: "Choose plan" });
  } else if (s.state === "due_soon") {
    alerts.push({ key: "due_soon", tone: "warning", text: s.daysLeft === 0 ? "Payment due today" : `Payment due in ${days(s.daysLeft)}`, action: "payment", actionLabel: "Record payment" });
  }

  const full = limitsReached(c);
  if (full.length) {
    alerts.push({ key: "at_limit", tone: "info", text: `At its plan limit for ${full.join(" and ")}: it can't add more`, action: "plan", actionLabel: "Upgrade plan" });
  }

  const ageDays = (now.getTime() - Date.parse(c.createdAt)) / 86_400_000;
  const quietDays = c.lastActivityAt ? (now.getTime() - Date.parse(c.lastActivityAt)) / 86_400_000 : ageDays;
  if (ageDays >= QUIET_DAYS && quietDays >= QUIET_DAYS) {
    alerts.push({ key: "quiet", tone: "info", text: c.lastActivityAt ? `No activity for ${days(Math.floor(quietDays))}` : "Never used since it was added", action: "open", actionLabel: "Open" });
  }
  return alerts;
}

/** Which plan limits the clinic has reached ("branches", "doctors", "staff"). */
export function limitsReached(c: Pick<PlatformClinic, "branches" | "doctors" | "staff" | "subscription">): string[] {
  const l = c.subscription?.limits;
  if (!l) return [];
  return ([["branches", c.branches, l.branches], ["doctors", c.doctors, l.doctors], ["staff", c.staff, l.staff]] as const)
    .filter(([, used, max]) => max !== null && used >= max)
    .map(([k]) => k);
}

export type ClinicSort = "attention" | "newest" | "name" | "paid_until" | "appointments";

const TONE_RANK: Record<AlertTone, number> = { danger: 0, warning: 1, info: 2 };
const urgency = (c: PlatformClinic) => Math.min(3, ...clinicAlerts(c).map((a) => TONE_RANK[a.tone]));

export function sortClinics(clinics: PlatformClinic[], sort: ClinicSort): PlatformClinic[] {
  const list = [...clinics];
  const byName = (a: PlatformClinic, b: PlatformClinic) => a.name.localeCompare(b.name);
  switch (sort) {
    case "attention":
      return list.sort((a, b) => urgency(a) - urgency(b) || byName(a, b));
    case "newest":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "name":
      return list.sort(byName);
    case "paid_until":
      // Soonest first; clinics without a plan last.
      return list.sort((a, b) => (a.subscription?.paidUntil ?? "9999").localeCompare(b.subscription?.paidUntil ?? "9999") || byName(a, b));
    case "appointments":
      return list.sort((a, b) => b.appointmentsThisMonth - a.appointmentsThisMonth || byName(a, b));
  }
}

/** The clinics list as CSV (opens in Excel / Google Sheets). */
export function clinicsCsv(clinics: PlatformClinic[]): string {
  const header = ["Code", "Clinic", "City", "State", "Phone", "Email", "Status", "Administrator", "Administrator email", "Plan", "Price", "Billing", "Paid until", "Branches", "Doctors", "Staff", "Patients", "Appointments this month", "Clinic collected this month", "Added on", "Last activity"];
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote everything; neutralise formulas a spreadsheet would run.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
  };
  const rows = clinics.map((c) => [
    c.code, c.name, c.city, c.state, c.phone, c.email, c.status,
    c.admins.map((a) => a.name).join("; "), c.admins.map((a) => a.email).join("; "),
    c.subscription?.planName, c.subscription?.price, c.subscription?.billingCycle, c.subscription?.paidUntil,
    c.branches, c.doctors, c.staff, c.patients, c.appointmentsThisMonth, c.revenueThisMonth,
    c.createdAt.slice(0, 10), c.lastActivityAt?.slice(0, 10),
  ].map(cell).join(","));
  return [header.map(cell).join(","), ...rows].join("\r\n");
}

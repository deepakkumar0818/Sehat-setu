// Pure rules for the super admin console's subscriptions (shared by the data
// layer and tests).
import type { PlatformSubscription, SubscriptionState } from "@/lib/live-types";

/** Today's date in India, yyyy-MM-dd (subscriptions are dated, not timed). */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `from` to `to` (both yyyy-MM-dd). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const DUE_SOON_DAYS = 7;

export function subscriptionState(planKey: string, paidUntil: string, today: string): { state: SubscriptionState; daysLeft: number } {
  const daysLeft = daysBetween(today, paidUntil);
  if (daysLeft < 0) return { state: "overdue", daysLeft };
  if (planKey === "TRIAL") return { state: "trial", daysLeft };
  return { state: daysLeft <= DUE_SOON_DAYS ? "due_soon" : "active", daysLeft };
}

/** yyyy-MM-dd plus whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** yyyy-MM-dd plus whole months, the day clamped to the month's end (31 Jan + 1 month = 28/29 Feb), as Postgres does. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/**
 * The paid-until date after a payment covering `months` (mirrors
 * app.platform_record_subscription_payment): the period starts the day after
 * the current paid-until, or on the payment date if that has already passed.
 */
export function paidUntilAfterPayment(paidUntil: string, paidOn: string, months: number): { from: string; to: string } {
  const next = addDays(paidUntil, 1);
  const from = next > paidOn ? next : paidOn;
  return { from, to: addDays(addMonths(from, months), -1) };
}

/** What a subscription is worth per month (rupees); trials and overdue clinics count as nothing. */
export function monthlyValue(sub: Pick<PlatformSubscription, "state" | "billingCycle" | "price"> | null): number {
  if (!sub || sub.state === "trial" || sub.state === "overdue") return 0;
  return sub.billingCycle === "yearly" ? Math.round((sub.price / 12) * 100) / 100 : sub.price;
}

/** The plan's price for a billing cycle, as the default agreed price. */
export function planPrice(plan: { monthlyPrice: number; yearlyPrice: number }, cycle: "monthly" | "yearly"): number {
  return cycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
}

const PLAN_LIMIT_TEXT: Record<string, string> = {
  BRANCHES: "branches",
  DOCTORS: "doctors",
  STAFF: "staff members",
};

/** A plan-limit refusal from the database ('plan: LIMIT_STAFF 10'), as a message for the clinic; null if it isn't one. */
export function planLimitMessage(text: string): string | null {
  const m = /plan: LIMIT_([A-Z]+) ([0-9]+)/.exec(text);
  if (!m || !PLAN_LIMIT_TEXT[m[1]]) return null;
  return `Your Sehat Setu plan allows up to ${m[2]} active ${PLAN_LIMIT_TEXT[m[1]]}. Deactivate one, or contact Sehat Setu to upgrade your plan.`;
}

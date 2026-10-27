import { describe, expect, it } from "vitest";
import { addMonths, daysBetween, istToday, monthlyValue, paidUntilAfterPayment, planLimitMessage, subscriptionState } from "./platform-rules";

describe("platform subscription rules", () => {
  it("uses India's date", () => {
    expect(istToday(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11-01"); // 00:30 IST
    expect(istToday(new Date("2026-10-31T18:00:00Z"))).toBe("2026-10-31");
  });

  it("states: trial, active, due soon, overdue", () => {
    expect(subscriptionState("TRIAL", "2026-11-10", "2026-11-01")).toEqual({ state: "trial", daysLeft: 9 });
    expect(subscriptionState("PRO", "2026-11-30", "2026-11-01")).toEqual({ state: "active", daysLeft: 29 });
    expect(subscriptionState("PRO", "2026-11-08", "2026-11-01").state).toBe("due_soon");
    expect(subscriptionState("PRO", "2026-11-01", "2026-11-01")).toEqual({ state: "due_soon", daysLeft: 0 });
    expect(subscriptionState("PRO", "2026-10-31", "2026-11-01")).toEqual({ state: "overdue", daysLeft: -1 });
    expect(subscriptionState("TRIAL", "2026-10-01", "2026-11-01").state).toBe("overdue");
  });

  it("month arithmetic matches Postgres (day clamped to the month's end)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("a payment extends from the day after paid-until, or from the payment date once lapsed", () => {
    expect(paidUntilAfterPayment("2026-11-30", "2026-11-20", 1)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(paidUntilAfterPayment("2026-11-30", "2026-11-20", 12)).toEqual({ from: "2026-12-01", to: "2027-11-30" });
    expect(paidUntilAfterPayment("2026-10-15", "2026-11-03", 1)).toEqual({ from: "2026-11-03", to: "2026-12-02" });
  });

  it("monthly recurring revenue counts paying clinics only", () => {
    expect(monthlyValue({ state: "active", billingCycle: "monthly", price: 2499 })).toBe(2499);
    expect(monthlyValue({ state: "due_soon", billingCycle: "yearly", price: 24990 })).toBe(2082.5);
    expect(monthlyValue({ state: "trial", billingCycle: "monthly", price: 999 })).toBe(0);
    expect(monthlyValue({ state: "overdue", billingCycle: "monthly", price: 999 })).toBe(0);
    expect(monthlyValue(null)).toBe(0);
  });

  it("turns plan-limit refusals into a message for the clinic", () => {
    expect(planLimitMessage("... plan: LIMIT_STAFF 10 ...")).toBe(
      "Your Sehat Setu plan allows up to 10 active staff members. Deactivate one, or contact Sehat Setu to upgrade your plan."
    );
    expect(planLimitMessage("plan: LIMIT_BRANCHES 1")).toMatch(/up to 1 active branches/);
    expect(planLimitMessage("platform: NOT_PERMITTED")).toBeNull();
    expect(planLimitMessage("plan: LIMIT_WIDGETS 3")).toBeNull();
  });
});

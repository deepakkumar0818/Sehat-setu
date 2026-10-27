import { describe, expect, it } from "vitest";
import type { PlatformClinic, PlatformSubscription } from "@/lib/live-types";
import { clinicAlerts, clinicsCsv, limitsReached, sortClinics } from "./platform-insights";

const NOW = new Date("2026-11-20T06:00:00Z");
const sub = (over: Partial<PlatformSubscription> = {}): PlatformSubscription => ({
  planId: "p", planKey: "PRO", planName: "Professional", billingCycle: "monthly", price: 2499, paidUntil: "2026-12-31",
  state: "active", daysLeft: 41, autoSuspend: false, graceDays: 7, suspendedForNonPayment: false, notes: null,
  limits: { branches: 3, doctors: 10, staff: 30 }, ...over,
});
const clinic = (over: Partial<PlatformClinic> = {}): PlatformClinic => ({
  id: "c1", code: "AAR", name: "Aarogya", email: "a@x.in", phone: "999", addressLine: "a", city: "Pune", state: "MH", pincode: "411001",
  status: "active", createdAt: "2026-10-01T00:00:00Z", branches: 1, staff: 4, doctors: 2, patients: 10, appointmentsThisMonth: 6,
  upcomingAppointments: 2, revenueThisMonth: 0, lastActivityAt: "2026-11-19T00:00:00Z",
  admins: [{ userId: "u", name: "Deepak", email: "d@x.in", status: "active" }], subscription: sub(), subscriptionCollectedThisMonth: 0, ...over,
});
const keys = (c: PlatformClinic) => clinicAlerts(c, NOW).map((a) => a.key);

describe("clinic alerts", () => {
  it("a healthy clinic has none", () => expect(keys(clinic())).toEqual([]));

  it("flags a clinic nobody can manage, or whose administrator never signed in", () => {
    expect(keys(clinic({ admins: [] }))).toEqual(["no_admin"]);
    expect(keys(clinic({ admins: [{ userId: "u", name: "R", email: "r@x.in", status: "invited" }] }))).toEqual(["admin_invited"]);
  });

  it("flags money: overdue, trial ending, due soon, no plan", () => {
    expect(clinicAlerts(clinic({ subscription: sub({ state: "overdue", daysLeft: -3 }) }), NOW)[0]).toMatchObject({ key: "overdue", text: "Payment overdue 3 days ago", action: "payment" });
    expect(clinicAlerts(clinic({ subscription: sub({ planKey: "TRIAL", state: "overdue", daysLeft: -1 }) }), NOW)[0]).toMatchObject({ text: "Free trial ended 1 day ago", action: "plan" });
    expect(clinicAlerts(clinic({ subscription: sub({ planKey: "TRIAL", state: "trial", daysLeft: 5 }) }), NOW)[0].text).toBe("Free trial ends in 5 days");
    expect(keys(clinic({ subscription: sub({ planKey: "TRIAL", state: "trial", daysLeft: 20 }) }))).toEqual([]);
    expect(keys(clinic({ subscription: sub({ state: "due_soon", daysLeft: 2 }) }))).toEqual(["due_soon"]);
    expect(keys(clinic({ subscription: null }))).toEqual(["no_plan"]);
  });

  it("flags a clinic at a plan limit", () => {
    const c = clinic({ branches: 3, staff: 30 });
    expect(limitsReached(c)).toEqual(["branches", "staff"]);
    expect(clinicAlerts(c, NOW)[0].text).toBe("At its plan limit for branches and staff: it can't add more");
  });

  it("flags quiet clinics, but not brand-new ones", () => {
    expect(clinicAlerts(clinic({ lastActivityAt: "2026-10-30T00:00:00Z" }), NOW)[0].text).toBe("No activity for 21 days");
    expect(clinicAlerts(clinic({ lastActivityAt: null }), NOW)[0].text).toBe("Never used since it was added");
    expect(keys(clinic({ lastActivityAt: null, createdAt: "2026-11-15T00:00:00Z" }))).toEqual([]);
  });

  it("a suspended clinic only reports a missing administrator", () => {
    expect(keys(clinic({ status: "suspended", subscription: sub({ state: "overdue", daysLeft: -30 }) }))).toEqual([]);
    expect(keys(clinic({ status: "suspended", admins: [] }))).toEqual(["no_admin"]);
  });
});

describe("sorting and export", () => {
  it("needs-attention first, then by name", () => {
    const list = [clinic({ id: "a", name: "Zen" }), clinic({ id: "b", name: "Beta", admins: [] }), clinic({ id: "c", name: "Alpha" })];
    expect(sortClinics(list, "attention").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(sortClinics(list, "name").map((c) => c.name)).toEqual(["Alpha", "Beta", "Zen"]);
  });

  it("CSV quotes cells and neutralises spreadsheet formulas", () => {
    const csv = clinicsCsv([clinic({ name: '=HYPERLINK("x")', city: 'Pune, "MH"' })]);
    const [head, row] = csv.split("\r\n");
    expect(head.startsWith('"Code","Clinic"')).toBe(true);
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"Pune, ""MH"""');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import type { AuditPage, ClinicProfile, ClinicSettings, ClinicSettingsPage, DepartmentPage, ExpensePage, LiveExpense } from "@/lib/live-types";
import { DEFAULT_SETTINGS } from "@/server/data/clinic-settings-rules";
import type { Branch } from "@/types";

// Clinic-admin pages in the live staff app, in a simulated browser: they read
// the clinic database API (replaced here: no network, no database), never the
// in-browser demo store, and show no switch that doesn't do anything. The
// server rules are tested in clinic-admin-rules.test.ts and
// clinic-admin.integration.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.hoisted(() => ({
  branches: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn() },
  departments: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn() },
  specialties: { list: vi.fn(), usage: vi.fn() },
  clinic: { get: vi.fn(), update: vi.fn(), settings: vi.fn(), updateSettings: vi.fn() },
  auditEvents: vi.fn(),
  expenses: { list: vi.fn(), create: vi.fn(), void: vi.fn() },
  billing: { summary: vi.fn() },
}));
vi.mock("@/lib/live-api", async (orig) => {
  const real = await orig<typeof import("@/lib/live-api")>();
  return { ...real, liveApi: { ...real.liveApi, ...api, billing: { ...real.liveApi.billing, ...api.billing } } };
});
// The demo store must never be read by these pages.
vi.mock("@/store/data-store", () => ({ useDataStore: () => { throw new Error("demo store read in live mode"); }, getDb: () => { throw new Error("demo store read"); } }));

const { LiveBranches } = await import("@/components/clinic-admin/live-branches");
const { LiveDepartments } = await import("@/components/clinic-admin/live-departments");
const { LiveSpecialties } = await import("@/components/clinic-admin/live-specialties");
const { LiveAuditLog } = await import("@/components/clinic-admin/live-audit-log");
const { LiveExpenses } = await import("@/components/clinic-admin/live-expenses");
const { LiveSettings } = await import("@/components/clinic-admin/live-settings");
const { LiveSubscription } = await import("@/components/clinic-admin/live-subscription");

const branch = (over: Partial<Branch> = {}): Branch => ({ id: "b1", clinicId: "c1", name: "Kothrud", code: "KOT", city: "Pune", address: "1 Main Rd", phone: "+91 20 1234 5678", isHeadOffice: true, status: "active", ...over });
const profile = (over: Partial<ClinicProfile> = {}): ClinicProfile => ({
  id: "c1", code: "AAR", name: "Aarogya Clinic", email: "hello@aarogya.test", phone: "+91 20 1234 5678", addressLine: "1 Main Rd", city: "Pune", state: "Maharashtra", pincode: "411038",
  currency: "INR", status: "active", canEdit: true, can: { createBranch: true, updateBranch: true, manageDepartments: true },
  usage: { branches: 2, activeBranches: 2, staff: 1, doctors: 0, patients: 0 }, ...over,
});
const settingsPage = (canEdit = true, over: Partial<ClinicSettings> = {}): ClinicSettingsPage => ({
  clinic: { name: "Aarogya Clinic", code: "AAR" }, settings: { ...DEFAULT_SETTINGS, ...over }, defaultInvoicePrefix: "AAR-INV-", canEdit,
});
const expense = (over: Partial<LiveExpense> = {}): LiveExpense => ({
  id: "e1", branchId: "b1", branchName: "Kothrud", category: "rent", description: "October rent", amount: 25000, date: "2026-10-01", paidTo: "Landlord", reference: null,
  status: "recorded", voidReason: null, recordedBy: "Admin", createdAt: "2026-10-01T05:00:00.000Z", ...over,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.clinic.get.mockResolvedValue(profile());
  api.clinic.settings.mockResolvedValue(settingsPage());
  api.clinic.updateSettings.mockImplementation(async (patch: Partial<ClinicSettings>) => settingsPage(true, patch));
  api.branches.list.mockResolvedValue([branch(), branch({ id: "b2", name: "Wakad", code: "WKD", isHeadOffice: false })]);
  api.specialties.usage.mockResolvedValue({ items: [{ id: "s1", name: "General Medicine", description: null, doctorCount: 0, departmentCount: 1 }, { id: "s2", name: "Dermatology", description: null, doctorCount: 0, departmentCount: 0 }] });
  api.billing.summary.mockResolvedValue({ todaysRevenue: 0, outstandingBalance: 0, totalRevenueThisMonth: 30000, totalExpensesThisMonth: 25000 });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
async function render(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={qc}><LiveDataProvider live>{ui}</LiveDataProvider></QueryClientProvider>));
  await settle();
}
const text = () => document.body.textContent ?? "";
const button = (label: string | RegExp) => {
  const b = [...document.querySelectorAll("button, a")].find((el) => (typeof label === "string" ? el.textContent?.trim() === label : label.test(el.textContent ?? "")));
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
/** Radix tabs switch on mouse down. */
const openTab = async (label: string) => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === label);
  if (!tab) throw new Error(`no tab ${label}`);
  await act(async () => { tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
  await settle();
};
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("live clinic setup", () => {
  it("branches: lists the clinic's branches; the head office can't be deactivated; adding sends only the form fields", async () => {
    api.branches.create.mockResolvedValue(branch({ id: "b3", name: "Baner", code: "BAN", isHeadOffice: false }));
    await render(<LiveBranches />);
    const cards = [...document.querySelectorAll('[data-testid="branch-card"]')];
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual(["Kothrud", "Wakad"]);
    expect(cards[0].textContent).toContain("Head Office");
    expect(cards[0].textContent).not.toContain("Deactivate");
    expect(cards[1].textContent).toContain("Deactivate");

    await click(button(/Add Branch/));
    await type(document.getElementById("b-name") as HTMLInputElement, "Baner");
    await type(document.getElementById("b-city") as HTMLInputElement, "Pune");
    await type(document.getElementById("b-address") as HTMLInputElement, "2 Hill Rd");
    await type(document.getElementById("b-phone") as HTMLInputElement, "9876543210");
    await click(button("Add branch"));
    expect(api.branches.create).toHaveBeenCalledWith({ name: "Baner", city: "Pune", address: "2 Hill Rd", phone: "9876543210", email: "", code: undefined });
  });

  it("branches: without branch permissions there's no add, edit or deactivate", async () => {
    api.clinic.get.mockResolvedValue(profile({ can: { createBranch: false, updateBranch: false, manageDepartments: false } }));
    await render(<LiveBranches />);
    expect(text()).toContain("Wakad");
    expect(text()).not.toMatch(/Add Branch|Edit|Deactivate/);
  });

  it("departments: clinic-wide and branch departments with doctor counts", async () => {
    const page: DepartmentPage = {
      canManage: true,
      items: [
        { id: "d1", name: "General Medicine", description: null, branchId: null, branchName: null, specialtyId: "s1", specialtyName: "General Medicine", status: "active", doctorCount: 2 },
        { id: "d2", name: "Paediatrics", description: "Children", branchId: "b2", branchName: "Wakad", specialtyId: null, specialtyName: null, status: "inactive", doctorCount: 0 },
      ],
    };
    api.departments.list.mockResolvedValue(page);
    await render(<LiveDepartments />);
    const cards = [...document.querySelectorAll('[data-testid="department-card"]')].map((c) => c.textContent);
    expect(cards[0]).toMatch(/General Medicine.*Active.*Clinic-wide · General Medicine.*2 doctors/);
    expect(cards[1]).toMatch(/Paediatrics.*Inactive.*Wakad.*Children.*0 doctors.*Reactivate/);
  });

  it("specialties: shared list, split into offered and not offered, with no add or toggle", async () => {
    await render(<LiveSpecialties />);
    expect(document.querySelector('[aria-label="Offered"]')?.textContent).toContain("General Medicine");
    expect(document.querySelector('[aria-label="Not offered"]')?.textContent).toContain("Dermatology");
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(text()).not.toContain("Add Specialty");
  });
});

describe("live audit log, expenses, settings and plan", () => {
  it("audit log: shows people, summaries and changed field names", async () => {
    const page: AuditPage = {
      total: 1, page: 1, pageSize: 25,
      items: [{ id: "x1", occurredAt: "2026-10-16T05:00:00.000Z", actorName: "Deepak Admin", summary: "Updated the clinic profile", action: "clinics.update", area: "setup", outcome: "success", changed: ["addressLine", "pincode"], reason: null }],
    };
    api.auditEvents.mockResolvedValue(page);
    await render(<LiveAuditLog />);
    const entry = document.querySelector('[data-testid="audit-entry"]')!.textContent;
    expect(entry).toMatch(/Deepak Admin · Updated the clinic profile/);
    expect(entry).toContain("changed address line, pincode");
    expect(entry).toContain("Clinic setup");
    expect(api.auditEvents).toHaveBeenCalledWith({ page: 1, pageSize: 25, search: undefined, area: undefined, outcome: undefined });
  });

  it("expenses: real month totals and net income; voiding asks for a reason", async () => {
    const page: ExpensePage = { items: [expense()], total: 1, page: 1, pageSize: 10, monthTotal: 25000, canManage: true };
    api.expenses.list.mockResolvedValue(page);
    api.expenses.void.mockResolvedValue(expense({ status: "voided", voidReason: "Entered twice" }));
    await render(<LiveExpenses />);
    expect(text()).toMatch(/Revenue this Month.*30,000/);
    expect(text()).toMatch(/Expenses this Month.*25,000/);
    expect(text()).toMatch(/Net Income.*5,000/);
    expect(text()).toContain("October rent");

    await click(button("Void"));
    const confirm = button("Void expense") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await type(document.getElementById("void-reason") as HTMLTextAreaElement, "Entered twice");
    await click(button("Void expense"));
    expect(api.expenses.void).toHaveBeenCalledWith("e1", "Entered twice");
  });

  it("settings: the clinic profile saves only changed fields", async () => {
    api.clinic.update.mockImplementation(async (patch: Partial<ClinicProfile>) => profile(patch));
    await render(<LiveSettings />);
    const save = button("Save changes") as HTMLButtonElement; // the profile form's, first on the page
    expect(save.disabled).toBe(true);
    await type(document.getElementById("clinic-city") as HTMLInputElement, "Mumbai");
    await click(save);
    expect(api.clinic.update).toHaveBeenCalledWith({ city: "Mumbai" });
    expect(api.clinic.updateSettings).not.toHaveBeenCalled();
  });

  it("settings: timings send only what changed, and the preview shows the resulting slots", async () => {
    await render(<LiveSettings />);
    await openTab("Clinic timings");
    expect(text()).toContain("14 slots of 30 minutes");
    expect(text()).toContain("Mon–Sat: 9:00 AM – 5:00 PM · Sun: Closed");
    await click(document.getElementById("open-sun") as HTMLElement);
    await click(button("Save changes"));
    expect(api.clinic.updateSettings).toHaveBeenCalledWith({ weeklyHours: { ...DEFAULT_SETTINGS.weeklyHours, sun: { open: "09:00", close: "17:00" } } });
  });

  it("settings: turning the break off sends both of its ends", async () => {
    await render(<LiveSettings />);
    await openTab("Clinic timings");
    await click(document.getElementById("has-break") as HTMLElement);
    expect(text()).toContain("16 slots of 30 minutes");
    await click(button("Save changes"));
    expect(api.clinic.updateSettings).toHaveBeenCalledWith({ breakStart: null, breakEnd: null });
  });

  it("settings: online booking rules are real switches saved to the clinic", async () => {
    await render(<LiveSettings />);
    await openTab("Online booking");
    await click(document.getElementById("bk-approve") as HTMLElement);
    expect(text()).toContain("Bookings are confirmed straight away");
    await click(button("Save changes"));
    expect(api.clinic.updateSettings).toHaveBeenCalledWith({ bookingNeedsApproval: false });
  });

  it("settings: billing shows the resulting invoice numbers and checks the GSTIN before saving", async () => {
    await render(<LiveSettings />);
    await openTab("Billing & invoices");
    expect(text()).toContain("AAR-INV-0001");
    await type(document.getElementById("bill-prefix") as HTMLInputElement, "aar/26-");
    expect(text()).toContain("AAR/26-0001");
    await type(document.getElementById("bill-gstin") as HTMLInputElement, "27ABC");
    expect(text()).toContain("Enter a valid 15-character GSTIN");
    expect((button("Save changes") as HTMLButtonElement).disabled).toBe(true);
    await type(document.getElementById("bill-gstin") as HTMLInputElement, "27ABCDE1234F1Z5");
    await click(button("Save changes"));
    expect(api.clinic.updateSettings).toHaveBeenCalledWith({ invoicePrefix: "AAR/26-", gstin: "27ABCDE1234F1Z5" });
  });

  it("settings: read-only for someone who can't edit the clinic", async () => {
    api.clinic.get.mockResolvedValue(profile({ canEdit: false }));
    api.clinic.settings.mockResolvedValue(settingsPage(false));
    await render(<LiveSettings />);
    expect((document.getElementById("clinic-name") as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain("Only a clinic administrator can change them.");
    expect(text()).not.toContain("Save changes");
    await openTab("Online booking");
    expect((document.getElementById("bk-on") as HTMLButtonElement).disabled).toBe(true);
    expect(text()).not.toContain("Save changes");
  });

  it("subscription: real usage and status; no invented plans, prices or invoices", async () => {
    await render(<LiveSubscription />);
    expect(text()).toContain("Active");
    expect(text()).toMatch(/Branches.*2 active/);
    expect(text()).toContain("Plan: not set up");
    expect(text()).not.toMatch(/₹|Upgrade|Downgrade|Invoice history/);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";
import type { PortalAppointment, PortalBookingOptions, PortalClinicRecord, PortalDashboard } from "@/lib/live-types";
import type { IntakeState } from "@/lib/patient-intake";

// Patient dashboard, booking, appointments and health profile in a simulated
// browser. The portal API is replaced (no network, no database); the server's
// rules are tested in portal-booking*.test.ts. Nothing here sends a patient id.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/portal", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.hoisted(() => ({ dashboard: vi.fn(), bookingOptions: vi.fn(), slots: vi.fn(), book: vi.fn(), appointments: vi.fn(), cancel: vi.fn(), reschedule: vi.fn(), record: vi.fn(), invoices: vi.fn() }));
vi.mock("@/lib/live-api", async (orig) => {
  const real = await orig<typeof import("@/lib/live-api")>();
  return { ...real, liveApi: { ...real.liveApi, portal: { ...real.liveApi.portal, ...api } } };
});

const { LivePortalAppointments, LivePortalBooking, LivePortalDashboard, LivePortalHealthProfile, LivePortalPayments } = await import("@/components/portal/live-portal-care");
const { OnboardingContext } = await import("@/components/portal/health-profile-card");

const appt = (over: Partial<PortalAppointment> = {}): PortalAppointment => ({
  id: "a1", reference: "A1B2C3D4", date: "2026-10-21", time: "10:00", startsAt: "2026-10-21T04:30:00.000Z", durationMinutes: 30, type: "in_person", status: "scheduled",
  reason: "Fever", doctorId: "d1", doctorName: "Dr. Asha Rao", specialty: "General Medicine", branchId: "b1", branchName: "Kothrud", canCancel: true, canReschedule: true, ...over,
});
const emptyDashboard: PortalDashboard = {
  clinicName: "Aarogya Clinic",
  patient: { name: "Test Patient", patientNumber: "AAR-P-0001", dateOfBirth: "1990-04-12", gender: "female", phone: "+91 98765 43210", email: "p@example.test", bloodGroup: null, branchName: "Kothrud" },
  upcoming: [], recent: [], invoices: { outstandingCount: 0, outstandingBalance: 0, latest: [] }, reportCount: 0, documentCount: 0,
};
const options: PortalBookingOptions = {
  clinicName: "Aarogya Clinic", maxDaysAhead: 60, rules: { open: true, needsApproval: true, minNoticeMinutes: 30, maxUpcoming: 5, slotMinutes: 30 },
  branches: [{ id: "b1", name: "Kothrud", city: "Pune", addressLine: "1 Main Rd" }],
  doctors: [{ id: "d1", name: "Dr. Asha Rao", specialty: "General Medicine", department: null, qualifications: "MBBS", experienceYears: 8, consultationFee: 500, offersOnline: true, branchIds: ["b1"] }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
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
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><LiveDataProvider live>{ui}</LiveDataProvider></QueryClientProvider>);
  });
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
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("patient dashboard", () => {
  it("shows the patient's own profile, quick actions and clear empty states", async () => {
    api.dashboard.mockResolvedValue(emptyDashboard);
    await render(<LivePortalDashboard />);
    expect(document.querySelector("h1")?.textContent).toBe("Test Patient");
    expect(text()).toMatch(/Good (morning|afternoon|evening),/);
    expect(text()).toContain("AAR-P-0001");
    expect(text()).toContain("Not recorded"); // blood group
    const links = [...document.querySelectorAll('nav[aria-label="Quick access"] a')].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/portal/appointments", "/portal/profile", "/portal/reports", "/portal/documents", "/portal/payments"]);
    // Booking is the prominent action in the welcome header, and offered again in the empty next-appointment card.
    expect(document.querySelector('[data-testid="portal-welcome"] a[href="/portal/book"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="next-appointment"] a[href="/portal/book"]')).not.toBeNull();
    expect(text()).toContain("No upcoming appointments");
    expect(text()).toContain("No past visits yet");
    expect(text()).toContain("Nothing to pay");
    // No clinic-wide figures: only the patient's own counts.
    expect(text()).not.toMatch(/patients today|revenue|waiting room/i);
  });

  it("shows the next appointment (doctor, place, time, status), past visits without actions, and unpaid bills", async () => {
    api.dashboard.mockResolvedValue({
      ...emptyDashboard,
      upcoming: [appt(), appt({ id: "a2", date: "2026-10-28" })],
      recent: [appt({ id: "a0", status: "completed", canCancel: false, canReschedule: false, date: "2026-09-01" })],
      invoices: { outstandingCount: 1, outstandingBalance: 450, latest: [{ id: "i1", invoiceNumber: "AAR-INV-2026-0007", issuedAt: "2026-09-01T06:00:00.000Z", dueDate: null, total: 500, paid: 50, balance: 450, status: "partially_paid", branchName: "Kothrud", appointmentDate: "2026-09-01" }] },
    });
    await render(<LivePortalDashboard />);
    const next = document.querySelector('[data-testid="next-appointment"]')!.textContent;
    expect(next).toMatch(/10:00 AM.*Scheduled.*Dr\. Asha Rao.*General Medicine.*Kothrud.*A1B2C3D4/);
    expect(next).toContain("+ 1 more upcoming");
    const rows = document.querySelectorAll('[data-testid="portal-appointment"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).not.toMatch(/Reschedule|Cancel/);
    expect(rows[0].textContent).toContain("Completed");
    expect(text()).toContain("AAR-INV-2026-0007");
    expect(text()).toContain("Partly paid");
  });

  it("an error is shown as an error, with a retry (no fallback data)", async () => {
    api.dashboard.mockRejectedValue(new ApiRequestError(500, "INTERNAL", "Something went wrong. Please try again."));
    await render(<LivePortalDashboard />);
    expect(text()).toMatch(/Couldn.t load your portal/);
  });
});

describe("booking", () => {
  async function toReview(online = false, opts = options) {
    api.bookingOptions.mockResolvedValue(opts);
    api.slots.mockResolvedValue({ date: "x", slots: ["10:00", "10:30"] });
    await render(<LivePortalBooking />);
    // One branch: straight to the doctor step.
    expect(text()).toContain("Choose a doctor");
    await click(document.querySelector('[data-testid="doctor-option"]') as HTMLElement);
    expect(text()).toContain("Choose a date and time");
    if (online) await click(document.querySelector('[role="radio"][aria-checked="false"]') as HTMLElement);
    const firstDay = document.querySelector('[aria-label="Choose a date"] [role="option"]') as HTMLElement;
    await click(firstDay);
    expect(api.slots).toHaveBeenCalledWith(expect.objectContaining({ doctorId: "d1", branchId: "b1" }));
    await click(button("10:00 AM"));
    await click(button("Continue"));
    await type(document.getElementById("reason") as HTMLInputElement, "Fever and cough");
    await settle();
    await click(button("Continue"));
    expect(document.querySelector('[data-testid="booking-review"]')?.textContent).toContain("Dr. Asha Rao");
  }

  it("walks doctor → date & time → reason → review, then shows the confirmation with its reference", async () => {
    await toReview();
    api.book.mockResolvedValue(appt({ reason: "Fever and cough" }));
    await click(button("Confirm booking"));
    const sent = api.book.mock.calls[0][0];
    expect(sent).toMatchObject({ branchId: "b1", doctorId: "d1", time: "10:00", reason: "Fever and cough", type: "in_person", symptoms: null });
    expect(Object.keys(sent)).not.toContain("patientId");
    expect(document.querySelector('[data-testid="booking-confirmation"]')?.textContent).toMatch(/Appointment booked.*A1B2C3D4/);
  });

  it("books an online consultation with a doctor who offers it; the option is disabled for one who doesn't", async () => {
    await toReview(true);
    expect(document.querySelector('[data-testid="booking-review"]')?.textContent).toContain("Online consultation");
    api.book.mockResolvedValue(appt({ type: "online" }));
    await click(button("Confirm booking"));
    expect(api.book.mock.calls[0][0]).toMatchObject({ type: "online" });
    expect(document.querySelector('[data-testid="booking-confirmation"]')?.textContent).toContain("joining details");

    act(() => root.unmount());
    root = createRoot(host);
    api.bookingOptions.mockResolvedValue({ ...options, doctors: [{ ...options.doctors[0], offersOnline: false }] });
    await render(<LivePortalBooking />);
    await click(document.querySelector('[data-testid="doctor-option"]') as HTMLElement);
    const online = [...document.querySelectorAll('[role="radio"]')].find((el) => el.textContent?.includes("Online")) as HTMLButtonElement;
    expect(online.disabled).toBe(true);
    expect(online.textContent).toContain("Not offered by this doctor");
  });

  it("a slot taken meanwhile sends the patient back to choose another time, with the reason", async () => {
    await toReview();
    api.book.mockRejectedValue(new ApiRequestError(409, "SLOT_TAKEN", "Sorry, that slot was just booked. Please choose another time."));
    await click(button("Confirm booking"));
    expect(text()).toContain("Choose a date and time");
    expect(text()).toContain("that slot was just booked");
    expect(document.querySelector('[data-testid="booking-confirmation"]')).toBeNull();
  });

  it("no doctors listed: a clear notice instead of an empty form", async () => {
    api.bookingOptions.mockResolvedValue({ ...options, doctors: [] });
    await render(<LivePortalBooking />);
    expect(text()).toContain("Online booking isn't open yet");
  });
});

describe("my appointments", () => {
  it("empty upcoming tab offers booking; cancelling asks first and calls the API with the appointment id only", async () => {
    api.appointments.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    await render(<LivePortalAppointments />);
    expect(text()).toContain("You have no upcoming appointments.");
    expect(api.appointments).toHaveBeenCalledWith({ scope: "upcoming", page: 1, pageSize: 10 });

    act(() => root.unmount());
    root = createRoot(host);
    api.appointments.mockResolvedValue({ items: [appt()], total: 1, page: 1, pageSize: 10 });
    api.cancel.mockResolvedValue(appt({ status: "cancelled", canCancel: false, canReschedule: false }));
    await render(<LivePortalAppointments />);
    await click(button("Cancel"));
    expect(text()).toContain("Cancel this appointment?");
    await click(button("Cancel appointment"));
    expect(api.cancel).toHaveBeenCalledWith("a1");
  });
});

describe("health profile and bills", () => {
  const record: PortalClinicRecord = {
    name: "Test Patient", patientNumber: "AAR-P-0001", dateOfBirth: "1990-04-12", gender: "female", phone: "+91 98765 43210", email: null, bloodGroup: "B+",
    addressLine: null, city: null, allergies: ["Penicillin"], chronicConditions: [], emergencyContactName: null, emergencyContactPhone: null, branchName: "Kothrud",
  };
  type Available = Extract<IntakeState, { available: true }>;
  const intake = (over: Partial<Available> = {}): Available => ({
    available: true, completed: true, progress: { personalSaved: true, medicalReviewed: true, completed: true },
    personal: { legalName: "Test Patient", dateOfBirth: "1990-04-12", gender: "FEMALE", phone: "+919876543210", addressLine: "1 Main Rd", city: "Pune" },
    medical: { allergyStatus: "NONE_KNOWN", allergies: [], medications: [{ name: "Metformin", dose: "500 mg", frequency: "twice daily" }], conditions: ["Diabetes"], pastSurgeries: null, familyHistory: null },
    appointments: [], recentSymptomReports: 0, ...over,
  });
  const openAt = vi.fn();
  const withOnboarding = (ui: React.ReactNode, state: Available = intake()) => <OnboardingContext.Provider value={{ state, openAt }}>{ui}</OnboardingContext.Provider>;
  const sectionButton = (name: string) => document.querySelector(`[aria-label="${name}"] button`) as HTMLButtonElement;

  it("loads the saved answers apart from the clinic's read-only record; each section opens on its own", async () => {
    api.record.mockResolvedValue(record);
    await render(withOnboarding(<LivePortalHealthProfile />));
    const mine = document.querySelector('[data-testid="patient-reported"]')!;
    expect(mine.textContent).toContain("Patient-reported");
    expect(mine.textContent).toMatch(/Metformin 500 mg twice daily.*Diabetes/);
    expect(mine.textContent).toContain("+91 98765 43210");
    const clinic = document.querySelector('[data-testid="clinic-record"]')!;
    expect(clinic.textContent).toContain("Kept by your clinic");
    expect(clinic.textContent).toContain("Penicillin");
    expect(clinic.querySelectorAll("input, textarea, select, button")).toHaveLength(0);
    await click(sectionButton("Allergies"));
    expect(openAt).toHaveBeenCalledWith(2, { section: true });
    await click(sectionButton("Symptoms before a visit"));
    expect(openAt).toHaveBeenCalledWith(3, { section: true });
  });

  it("allergy states stay distinct: none known, unknown, has allergies (with the list), not answered", async () => {
    api.record.mockResolvedValue(record);
    const label = async (medical: Available["medical"]) => {
      act(() => root.unmount());
      root = createRoot(host);
      await render(withOnboarding(<LivePortalHealthProfile />, intake({ medical })));
      return document.querySelector('[data-testid="allergy-status"]')?.textContent;
    };
    const base = intake().medical!;
    expect(await label({ ...base, allergyStatus: "NONE_KNOWN" })).toBe("No known allergies");
    expect(await label({ ...base, allergyStatus: "UNKNOWN" })).toBe("Unknown / not yet confirmed");
    expect(await label({ ...base, allergyStatus: "HAS_ALLERGIES", allergies: [{ substance: "Peanuts", reaction: "rash" }] })).toMatch(/Has allergies.*Peanuts — rash/);
    expect(await label({ ...base, allergyStatus: "NOT_ANSWERED" })).toBe("Not answered");
  });

  it("before personal details are saved, only the guided setup is offered; a load failure is an error with retry", async () => {
    api.record.mockResolvedValue(record);
    await render(withOnboarding(<LivePortalHealthProfile />, intake({ completed: false, progress: { personalSaved: false, medicalReviewed: false, completed: false }, medical: null })));
    expect(document.querySelector('[data-testid="profile-setup"]')?.textContent).toContain("Set up your health profile");
    expect(sectionButton("Allergies").disabled).toBe(true);
    await click(button("Start"));
    expect(openAt).toHaveBeenLastCalledWith();

    act(() => root.unmount());
    root = createRoot(host);
    await render(<LivePortalHealthProfile />);
    expect(text()).toContain("Your health profile couldn't be loaded");
  });

  it("bills: empty state", async () => {
    api.invoices.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    await render(<LivePortalPayments />);
    expect(text()).toContain("No bills yet");
  });
});

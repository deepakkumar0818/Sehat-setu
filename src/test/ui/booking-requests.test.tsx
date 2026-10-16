// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";
import type { BookingRequest, PortalAppointment } from "@/lib/live-types";

// Reception's "Pending Patient Bookings" panel and the patient's view of a
// request, in a simulated browser. The API is replaced (no network, no
// database); the rules themselves are tested in booking-review.test.ts and on a
// throwaway PostgreSQL.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/appointments", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.hoisted(() => ({
  bookingRequests: { list: vi.fn(), approve: vi.fn(), reject: vi.fn() },
  portal: { appointments: vi.fn() },
}));
vi.mock("@/lib/live-api", async (orig) => {
  const real = await orig<typeof import("@/lib/live-api")>();
  return { ...real, liveApi: { ...real.liveApi, bookingRequests: api.bookingRequests, portal: { ...real.liveApi.portal, ...api.portal } } };
});

const { PendingBookingRequests } = await import("@/components/appointments/pending-booking-requests");
const { LivePortalAppointments } = await import("@/components/portal/live-portal-care");

const request = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  id: "r1", patientId: "p1", patientName: "Asha Patil", patientNumber: "AAR-P-0001", doctorId: "d1", doctorName: "Dr. Rao", specialty: "General", branchId: "b1",
  branchName: "Kothrud", date: "2026-10-21", time: "10:00", startsAt: "2026-10-21T04:30:00.000Z", type: "in_person", reason: "Fever", requestedAt: "2026-10-20T04:00:00.000Z",
  hasSymptomReport: true, expired: false, ...over,
});
const appt = (over: Partial<PortalAppointment> = {}): PortalAppointment => ({
  id: "a1", reference: "A1B2C3D4", date: "2099-10-21", time: "10:00", startsAt: "2099-10-21T04:30:00.000Z", durationMinutes: 30, type: "in_person", status: "pending_approval",
  reason: "Fever", doctorId: "d1", doctorName: "Dr. Rao", specialty: "General", branchId: "b1", branchName: "Kothrud", canCancel: true, canReschedule: true, ...over,
});

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
  await act(async () => root.render(<QueryClientProvider client={qc}><LiveDataProvider live>{ui}</LiveDataProvider></QueryClientProvider>));
  await settle();
}
const text = () => document.body.textContent ?? "";
const button = (label: string | RegExp) => {
  const b = [...document.querySelectorAll("button")].find((el) => (typeof label === "string" ? el.textContent?.trim() === label : label.test(el.getAttribute("aria-label") ?? el.textContent ?? "")));
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLButtonElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
async function type(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Pending Patient Bookings (reception)", () => {
  it("shows patient, number, doctor, branch, time and reason; approves once per click", async () => {
    api.bookingRequests.list.mockResolvedValue({ items: [request()], total: 1, canReview: true });
    let resolve!: (v: unknown) => void;
    api.bookingRequests.approve.mockReturnValue(new Promise((r) => (resolve = r)));
    await render(<PendingBookingRequests />);
    const row = document.querySelector('[data-testid="booking-request"]')!.textContent!;
    expect(row).toMatch(/Asha Patil.*AAR-P-0001/);
    expect(row).toMatch(/21 Oct 2026 at 10:00 AM.*Dr\. Rao \(General\).*Kothrud/);
    expect(row).toContain("Reason: Fever");
    expect(row).toContain("Symptoms submitted");
    await click(button(/Approve request/));
    await click(button(/Approve request/)); // a second click while the first is in flight does nothing
    expect(api.bookingRequests.approve).toHaveBeenCalledTimes(1);
    expect(api.bookingRequests.approve).toHaveBeenCalledWith("r1");
    resolve({ id: "r1", status: "confirmed", decidedAt: "x" });
    await settle();
  });

  it("a slot that's no longer free is explained next to the request, not approved", async () => {
    api.bookingRequests.list.mockResolvedValue({ items: [request()], total: 1, canReview: true });
    api.bookingRequests.approve.mockRejectedValue(new ApiRequestError(409, "SLOT_TAKEN", "That slot is already taken by another appointment. Decline this request and offer the patient another time."));
    await render(<PendingBookingRequests />);
    await click(button(/Approve request/));
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/already taken/);
  });

  it("rejecting requires a reason, which is sent", async () => {
    api.bookingRequests.list.mockResolvedValue({ items: [request()], total: 1, canReview: true });
    api.bookingRequests.reject.mockResolvedValue({ id: "r1", status: "rejected", decidedAt: "x" });
    await render(<PendingBookingRequests />);
    await click(button(/Reject request from/));
    expect(button("Reject request").disabled).toBe(true);
    await type(document.getElementById("reject-reason") as HTMLTextAreaElement, "Doctor is on leave that day");
    await click(button("Reject request"));
    expect(api.bookingRequests.reject).toHaveBeenCalledWith("r1", "Doctor is on leave that day");
  });

  it("an expired request can only be declined", async () => {
    api.bookingRequests.list.mockResolvedValue({ items: [request({ expired: true })], total: 1, canReview: true });
    await render(<PendingBookingRequests />);
    expect(text()).toContain("Time has passed");
    expect(button(/Approve request/).disabled).toBe(true);
    expect(button(/Reject request from/).disabled).toBe(false);
  });

  it("is hidden for roles that may not decide (403)", async () => {
    api.bookingRequests.list.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "Not allowed"));
    await render(<PendingBookingRequests />);
    expect(document.getElementById("booking-requests")).toBeNull();
  });
});

describe("the patient's view of a request", () => {
  it("pending: 'Awaiting receptionist approval', not confirmed; can be withdrawn", async () => {
    api.portal.appointments.mockResolvedValue({ items: [appt()], total: 1, page: 1, pageSize: 10 });
    await render(<LivePortalAppointments />);
    const row = document.querySelector('[data-testid="portal-appointment"]')!.textContent!;
    expect(row).toContain("Awaiting receptionist approval");
    expect(row).toContain("Not confirmed yet");
    expect(row).not.toContain("Confirmed");
    expect(button("Withdraw")).toBeTruthy();
  });

  it("declined: shows the clinic's reason; confirmed and completed are labelled as such", async () => {
    api.portal.appointments.mockResolvedValue({
      items: [
        appt({ id: "x1", status: "rejected", rejectionReason: "Doctor is on leave", canCancel: false, canReschedule: false }),
        appt({ id: "x2", status: "confirmed" }),
        appt({ id: "x3", status: "completed", canCancel: false, canReschedule: false }),
        appt({ id: "x4", status: "cancelled", canCancel: false, canReschedule: false }),
      ],
      total: 4, page: 1, pageSize: 10,
    });
    await render(<LivePortalAppointments />);
    expect(document.querySelector('[data-testid="rejection-reason"]')?.textContent).toContain("declined this request: Doctor is on leave");
    const rows = [...document.querySelectorAll('[data-testid="portal-appointment"]')].map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Declined");
    expect(rows[1]).toContain("Confirmed");
    expect(rows[2]).toContain("Completed");
    expect(rows[3]).toContain("Cancelled");
  });

  it("a request whose time passed without approval reads as expired", async () => {
    api.portal.appointments.mockResolvedValue({ items: [appt({ startsAt: "2020-01-01T04:30:00.000Z", date: "2020-01-01", canCancel: false, canReschedule: false })], total: 1, page: 1, pageSize: 10 });
    await render(<LivePortalAppointments />);
    expect(text()).toContain("Request expired");
    expect(text()).toContain("didn't confirm this request before its time");
  });
});

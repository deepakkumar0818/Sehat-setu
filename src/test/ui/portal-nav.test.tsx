// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LiveDataProvider } from "@/lib/data-source";

// Patient portal navigation (live): the grouped desktop sidebar, the phone's
// bottom bar and its Menu sheet, active states, and no links to pages that
// aren't connected to clinic records yet.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ pathname: "/portal" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
// The header's bell and account menu have their own tests; only its links matter here.
vi.mock("@/components/layout/notifications-menu", () => ({ NotificationsMenu: () => null }));
vi.mock("@/components/layout/user-menu", () => ({ UserMenu: () => null }));

const { PortalSidebar } = await import("@/components/portal/portal-sidebar");
const { PortalBottomNav } = await import("@/components/portal/portal-bottom-nav");
const { PortalHeader } = await import("@/components/portal/portal-header");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const render = (ui: React.ReactNode, live = true) => act(() => root.render(<LiveDataProvider live={live}>{ui}</LiveDataProvider>));
const hrefs = (scope: ParentNode) => [...scope.querySelectorAll("a")].map((a) => a.getAttribute("href"));

describe("live portal navigation", () => {
  it("sidebar: Home, Appointments (Book, My Appointments), My Health (Health Profile, Reports, Documents), Bills — with one active link", () => {
    nav.pathname = "/portal/reports/abc";
    render(<PortalSidebar />);
    const sidebar = document.querySelector('nav[aria-label="Patient portal"]')!;
    expect(sidebar.textContent).toBe("HomeAppointmentsBook AppointmentMy AppointmentsMy HealthHealth ProfileReportsDocumentsBills & PaymentsAccountAccount Settings");
    expect(hrefs(sidebar)).toEqual(["/portal", "/portal/book", "/portal/appointments", "/portal/profile", "/portal/reports", "/portal/documents", "/portal/payments", "/portal/settings"]);
    const active = [...sidebar.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent);
    expect(active).toEqual(["Reports"]);
  });

  it("phone: Home, Book, Appointments, My Health and a Menu with every page; My Health lights up for reports and documents", () => {
    nav.pathname = "/portal/documents";
    render(<PortalBottomNav />);
    const bar = document.querySelector('nav[aria-label="Portal shortcuts"]')!;
    expect(hrefs(bar)).toEqual(["/portal", "/portal/book", "/portal/appointments", "/portal/profile"]);
    expect(bar.querySelector('[aria-current="page"]')?.textContent).toBe("My Health");
    act(() => (bar.querySelector("button") as HTMLButtonElement).click());
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain("My Health");
    expect(hrefs(sheet)).toEqual(["/portal", "/portal/book", "/portal/appointments", "/portal/profile", "/portal/reports", "/portal/documents", "/portal/payments", "/portal/settings"]);
  });

  it("never links to pages that aren't connected yet (AI assistant, consultations, prescriptions)", () => {
    render(<><PortalSidebar /><PortalBottomNav /><PortalHeader live /></>);
    for (const href of hrefs(document)) expect(href, href ?? "").not.toMatch(/ai-assistant|consultation|prescription/);
    // The demo portal keeps its shortcut.
    act(() => root.unmount());
    root = createRoot(host);
    render(<PortalHeader />, false);
    expect(hrefs(document)).toContain("/portal/ai-assistant");
  });
});

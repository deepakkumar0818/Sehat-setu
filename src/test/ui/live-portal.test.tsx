// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";
import { isLivePortalPath, portalNav } from "@/lib/nav-config";
import type { PortalLabReportDetail, PortalSummary } from "@/lib/live-types";

// P6.3 portal screens in a simulated browser. The portal API is replaced (no
// network, no database); demo hooks are spied on to prove live mode never reads
// mock data. Authorization is tested on the server (portal.integration.test.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/portal", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({ summary: vi.fn(), dashboard: vi.fn(), labReports: vi.fn(), labReport: vi.fn(), documents: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/live-api", async (orig) => {
  const real = await orig<typeof import("@/lib/live-api")>();
  return { ...real, liveApi: { ...real.liveApi, portal: { ...real.liveApi.portal, ...api } } };
});
const demo = vi.hoisted(() => ({ useReports: vi.fn(), useDocuments: vi.fn(), useAppointments: vi.fn() }));
vi.mock("@/hooks/use-clinical", async (orig) => {
  const real = await orig<typeof import("@/hooks/use-clinical")>();
  return {
    ...real,
    useReports: (...a: Parameters<typeof real.useReports>) => (demo.useReports(...a), real.useReports(...a)),
    useDocuments: (...a: Parameters<typeof real.useDocuments>) => (demo.useDocuments(...a), real.useDocuments(...a)),
  };
});
vi.mock("@/hooks/use-appointments", async (orig) => {
  const real = await orig<typeof import("@/hooks/use-appointments")>();
  return { ...real, useAppointments: (...a: Parameters<typeof real.useAppointments>) => (demo.useAppointments(...a), real.useAppointments(...a)) };
});

const { default: PortalHome } = await import("@/app/(portal)/portal/page");
const { default: PortalReports } = await import("@/app/(portal)/portal/reports/page");
const { default: PortalDocuments } = await import("@/app/(portal)/portal/documents/page");
const { LivePortalReportDetail } = await import("@/components/portal/live-portal");

const summary: PortalSummary = {
  clinicName: "Aarogya Clinic", patient: { name: "Test Patient", patientNumber: "AAR-P-0001" }, reportCount: 1, documentCount: 1,
  latestReports: [{ id: "r1", testType: "CBC", title: "Blood count", resultDate: "2026-10-13", reviewedAt: "2026-10-13T08:00:00.000Z", sharedAt: "2026-10-13T09:00:00.000Z", branchName: "Kothrud", orderedByName: "Dr. Test", fileCount: 1 }],
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
async function render(ui: React.ReactNode, live = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><LiveDataProvider live={live}>{ui}</LiveDataProvider></QueryClientProvider>);
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const text = () => document.body.textContent ?? "";

describe("patient portal (live)", () => {
  it("home shows only the patient's own dashboard from the server and never touches demo hooks", async () => {
    api.dashboard.mockResolvedValue({
      clinicName: "Aarogya Clinic",
      patient: { name: "Test Patient", patientNumber: "AAR-P-0001", dateOfBirth: "1990-04-12", gender: "female", phone: "+91 98765 43210", email: null, bloodGroup: "B+", branchName: "Kothrud" },
      upcoming: [], recent: [], invoices: { outstandingCount: 0, outstandingBalance: 0, latest: [] }, reportCount: 1, documentCount: 1,
    });
    await render(<PortalHome />);
    expect(document.querySelector("h1")?.textContent).toBe("Test Patient");
    expect(text()).toContain("AAR-P-0001");
    expect(text()).toContain("Book Appointment");
    expect(text()).toContain("1 shared"); // reports quick-access card
    expect(text()).toContain("1 file");
    expect(text()).not.toContain("1 files");
    expect(text()).not.toMatch(/Online Consultation|AI Assistant/);
    expect(api.summary).not.toHaveBeenCalled();
    expect(demo.useAppointments).not.toHaveBeenCalled();
  });

  it("lab reports and documents: empty states, and errors shown as errors (no fallback)", async () => {
    api.labReports.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    await render(<PortalReports />);
    expect(text()).toContain("No lab reports yet");
    expect(demo.useReports).not.toHaveBeenCalled();
    api.documents.mockRejectedValue(new ApiRequestError(500, "INTERNAL", "Something went wrong. Please try again."));
    await render(<PortalDocuments />);
    expect(text()).toMatch(/Couldn.t load your documents/);
    expect(demo.useDocuments).not.toHaveBeenCalled();
  });

  it("report detail: values and files; no internal notes field exists to show", async () => {
    const detail: PortalLabReportDetail = {
      ...summary.latestReports[0],
      values: [{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }],
      files: [{ id: "f1", labReportId: "r1", labReportTitle: "Blood count", title: "CBC file", filename: "cbc.pdf", mimeType: "application/pdf", sizeBytes: 2048, uploadedAt: "2026-10-13T08:30:00.000Z" }],
    };
    api.labReport.mockResolvedValue(detail);
    await render(<LivePortalReportDetail id="r1" />);
    expect(text()).toContain("Hb");
    expect(text()).toContain("CBC file");
    expect([...document.querySelectorAll("button")].some((b) => /Download/.test(b.textContent ?? ""))).toBe(true);
  });

  it("an unavailable report reveals nothing about why", async () => {
    api.labReport.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "Not found."));
    await render(<LivePortalReportDetail id="r404" />);
    expect(text()).toContain("This report isn't available");
    expect(text()).not.toMatch(/unshared|another patient|does not exist/i);
  });

  it("demo mode keeps the mock portal pages", async () => {
    await render(<PortalReports />, false);
    expect(demo.useReports).toHaveBeenCalled();
    expect(api.labReports).not.toHaveBeenCalled();
  });
});

describe("live portal navigation", () => {
  it("offers only the database-backed pages; others are blocked by the shell", () => {
    expect(portalNav(true).map((i) => i.href)).toEqual(["/portal", "/portal/book", "/portal/appointments", "/portal/profile", "/portal/reports", "/portal/documents", "/portal/payments", "/portal/settings"]);
    expect(portalNav(true).map((i) => i.label)).toEqual(["Home", "Book Appointment", "My Appointments", "Health Profile", "Reports", "Documents", "Bills & Payments", "Account Settings"]);
    expect(portalNav(false).length).toBeGreaterThan(3);
    for (const p of ["/portal", "/portal/book", "/portal/appointments", "/portal/appointments/abc", "/portal/profile", "/portal/reports", "/portal/reports/abc", "/portal/documents", "/portal/payments", "/portal/settings"]) {
      expect(isLivePortalPath(p), p).toBe(true);
    }
    for (const p of ["/portal/prescriptions", "/portal/ai-assistant", "/portal/consultations", "/portal/consultation/abc", "/portal/reportsx", "/portal/bookings"]) {
      expect(isLivePortalPath(p), p).toBe(false);
    }
  });
});

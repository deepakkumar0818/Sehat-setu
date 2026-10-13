// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";
import type { FinancialReport, OperationalReport, ReportScope } from "@/lib/live-types";

// The /analytics page in a simulated browser. Live mode renders the database
// reports (hooks replaced: no network, no database) and must never touch the
// demo analytics or AI services; demo mode keeps the mock page. Authorization
// is the server's job (reports.integration.test.ts, reports-routes.integration.test.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const h = vi.hoisted(() => ({
  operational: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: () => {} },
  financial: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: () => {} },
  operationalCalls: [] as { params: unknown; enabled: boolean }[],
}));
vi.mock("@/hooks/use-reports", () => ({
  useOperationalReport: (params: unknown, enabled: boolean) => {
    h.operationalCalls.push({ params, enabled });
    return h.operational;
  },
  useFinancialReport: () => h.financial,
  useDownloadReport: () => ({ mutate: vi.fn(), isPending: false }),
}));
const demo = vi.hoisted(() => ({
  getDashboardKpis: vi.fn(async () => ({ totalPatients: 0, todaysAppointments: 0, todaysRevenue: 0, pendingReports: 0, waitingPatients: 0, onlineConsultationsToday: 0, outstandingPayments: 0, lowStockMedicines: 0 })),
  getRevenueTrend: vi.fn(async () => []),
  getPatientGrowth: vi.fn(async () => []),
  getAppointmentStatusBreakdown: vi.fn(async () => []),
  getDoctorPerformance: vi.fn(async () => []),
}));
vi.mock("@/services/analytics", () => demo);
const ai = vi.hoisted(() => ({ generateClinicInsights: vi.fn(async () => []) }));
vi.mock("@/services/ai", async (orig) => ({ ...(await orig<typeof import("@/services/ai")>()), generateClinicInsights: ai.generateClinicInsights }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AnalyticsPage } = await import("@/app/(app)/analytics/page");

const scope = (over: Partial<ReportScope> = {}): ReportScope => ({
  from: "2026-09-14", to: "2026-10-13", branchId: null, branchLocked: false,
  branches: [{ id: "b1", name: "Kothrud" }, { id: "b2", name: "Wakad" }],
  ownAppointmentsOnly: false, canViewFinancial: true, canExport: true, generatedAt: "2026-10-13T10:00:00.000Z", ...over,
});
const counts = { total: 12, completed: 7, upcoming: 2, inProgress: 0, cancelled: 2, noShow: 1 };
const report = (over: Partial<OperationalReport> = {}): OperationalReport => ({
  scope: scope(),
  appointments: { totals: counts, byBranch: [{ branchId: "b1", branchName: "Kothrud", ...counts }], daily: [{ date: "2026-10-13", ...counts }], monthly: [{ month: "2026-10", ...counts }] },
  patients: { total: 4, byBranch: [{ branchId: "b1", branchName: "Kothrud", count: 4 }], daily: [{ date: "2026-10-13", count: 4 }], monthly: [{ month: "2026-10", count: 4 }] },
  workload: { doctors: [{ doctorId: "d1", doctorName: "Dr. Asha Rao", ...counts, noShowRate: 0.125, avgConsultationMinutes: null, durationSamples: 0 }], duration: { available: false, reason: "no_reliable_timestamps", excluded: 7 } },
  unavailable: [],
  ...over,
});
const finance: FinancialReport = {
  scope: scope(),
  collections: { netPaise: 1234550, refundedPaise: 40000, grossPaise: 1274550, paymentCount: 9, refundCount: 1, daily: [{ date: "2026-10-13", netPaise: 1234550, refundedPaise: 40000 }], byMethod: [{ method: "upi", netPaise: 1234550, payments: 9, refundedPaise: 40000, refunds: 1 }], byBranch: [] },
  billed: { invoicedPaise: 2000000, invoiceCount: 10, voidCount: 0, voidPaise: 0 },
  outstanding: { asOf: "2026-10-13", totalPaise: 500000, invoiceCount: 2, bands: [{ band: "current", invoiceCount: 2, balancePaise: 500000 }, { band: "d1_30", invoiceCount: 0, balancePaise: 0 }, { band: "d31_60", invoiceCount: 0, balancePaise: 0 }, { band: "d61_90", invoiceCount: 0, balancePaise: 0 }, { band: "d90_plus", invoiceCount: 0, balancePaise: 0 }] },
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  h.operational = { data: report(), isLoading: false, isError: false, error: null, refetch: () => {} };
  h.financial = { data: finance, isLoading: false, isError: false, error: null, refetch: () => {} };
  h.operationalCalls = [];
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

const render = (live: boolean) =>
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <LiveDataProvider live={live}>
          <AnalyticsPage />
        </LiveDataProvider>
      </QueryClientProvider>
    )
  );
const text = () => document.body.textContent ?? "";

describe("reports page (live)", () => {
  it("shows live figures, marked as live, and never calls the demo analytics or AI services", async () => {
    render(true);
    expect(text()).toContain("Live data");
    expect(text()).toContain("Clinic reports");
    expect(text()).toMatch(/Appointments\s*12/);
    expect(text()).toContain("Dr. Asha Rao");
    expect(text()).toContain("12.5%");
    expect(text()).toContain("Consultation length isn't shown");
    expect(text()).toContain("Export CSV");
    await act(async () => {}); // let any stray query run
    for (const fn of Object.values(demo)) expect(fn).not.toHaveBeenCalled();
    expect(ai.generateClinicInsights).not.toHaveBeenCalled();
    expect(text()).not.toContain("AI Insights");
  });

  it("hides the financial tab and export when the role can't use them", () => {
    h.operational.data = report({ scope: scope({ canViewFinancial: false, canExport: false }) });
    render(true);
    expect(text()).toContain("Operational");
    expect(text()).not.toContain("Financial");
    expect(text()).not.toContain("Export CSV");
  });

  it("says a section isn't available instead of showing zeros", () => {
    h.operational.data = report({ patients: null, unavailable: [{ section: "patients", reason: "not_permitted" }] });
    render(true);
    expect(text()).toContain("Patient registration reports aren't available to you");
    expect(text()).toMatch(/New patients\s*—/);
  });

  it("a branch-limited user sees their branch locked, not a choice", () => {
    h.operational.data = report({ scope: scope({ branchLocked: true, branchId: "b2", branches: [{ id: "b2", name: "Wakad" }] }) });
    render(true);
    expect(text()).toContain("Wakad");
    expect(document.getElementById("report-branch")).toBeNull();
  });

  it("an invalid range is explained and not requested", () => {
    render(true);
    const from = document.getElementById("report-from") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(from, "2026-12-01");
      from.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector("[role=alert]")?.textContent).toBe("The start date must be on or before the end date.");
    expect(h.operationalCalls.at(-1)).toMatchObject({ enabled: false });
  });

  it("shows errors honestly: 403 as not available, others with a retry", () => {
    h.operational = { ...h.operational, data: undefined, isError: true, error: new ApiRequestError(403, "FORBIDDEN", "Not allowed") };
    render(true);
    expect(text()).toContain("Reports aren't available to you");
    act(() => root.unmount());
    root = createRoot(host);
    h.operational = { ...h.operational, error: new ApiRequestError(500, "INTERNAL", "Something went wrong. Please try again.") };
    render(true);
    expect(text()).toContain("Couldn't load reports");
  });
});

describe("analytics page (demo mode)", () => {
  it("keeps the mock analytics page, without the live badge", async () => {
    render(false);
    await act(async () => {});
    expect(text()).toContain("Analytics");
    expect(text()).not.toContain("Live data");
    expect(demo.getRevenueTrend).toHaveBeenCalled();
    expect(h.operationalCalls).toHaveLength(0);
  });
});

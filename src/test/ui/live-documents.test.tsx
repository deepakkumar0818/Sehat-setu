// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";
import type { DocumentPage, LabReportPage, LiveDocument, LiveLabReportDetail } from "@/lib/live-types";

// P6.2 live screens in a simulated browser. The live API is replaced (no
// network, no database); the demo hooks are spied on to prove live mode never
// reads mock data. Authorization itself is tested on the server
// (documents.integration.test.ts, documents-routes.test.ts, verify-rls).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
// jsdom's File may lack arrayBuffer(); the dialogs read the bytes to validate them.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.readAsArrayBuffer(this);
    });
  };
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/documents", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listForPatient: vi.fn(),
  upload: vi.fn(),
  labList: vi.fn(),
  labGet: vi.fn(),
}));
vi.mock("@/lib/live-api", async (orig) => {
  const real = await orig<typeof import("@/lib/live-api")>();
  return {
    ...real,
    liveApi: {
      ...real.liveApi,
      documents: { ...real.liveApi.documents, list: api.list, listForPatient: api.listForPatient, upload: api.upload },
      labReports: { ...real.liveApi.labReports, list: api.labList, get: api.labGet },
    },
  };
});
const demo = vi.hoisted(() => ({ useDocuments: vi.fn(), useReports: vi.fn(), useReport: vi.fn() }));
vi.mock("@/hooks/use-clinical", async (orig) => {
  const real = await orig<typeof import("@/hooks/use-clinical")>();
  return {
    ...real,
    useDocuments: (...a: Parameters<typeof real.useDocuments>) => (demo.useDocuments(...a), real.useDocuments(...a)),
    useReports: (...a: Parameters<typeof real.useReports>) => (demo.useReports(...a), real.useReports(...a)),
    useReport: (...a: Parameters<typeof real.useReport>) => (demo.useReport(...a), real.useReport(...a)),
  };
});

const { default: DocumentsPage } = await import("@/app/(app)/documents/page");
const { default: ReportsPage } = await import("@/app/(app)/reports/page");
const { LivePatientDocuments } = await import("@/components/documents/live-documents");
const { LiveLabReportDetail } = await import("@/components/lab-reports/live-lab-report-detail");

const doc = (over: Partial<LiveDocument> = {}): LiveDocument => ({
  id: "d1", patientId: "p1", patientName: "Test Patient", patientNumber: "AAR-P-1", branch: { id: "b1", name: "Wakad" }, category: "ID_PROOF", clinical: false,
  title: "Aadhaar card", filename: "aadhaar.png", mimeType: "image/png", sizeBytes: 2048, status: "AVAILABLE", uploadedAt: "2026-10-14T05:00:00.000Z",
  uploadedByName: "Reception", labReportId: null, consultationId: null, archivedAt: null, archiveReason: null, canArchive: false, ...over,
});
const page = (over: Partial<DocumentPage> = {}): DocumentPage => ({
  items: [doc()], total: 1, page: 1, pageSize: 18, canUploadClinical: true, canUploadAdministrative: true, canViewClinical: false, storageConfigured: true, ...over,
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

async function render(ui: React.ReactNode, live = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><LiveDataProvider live={live}>{ui}</LiveDataProvider></QueryClientProvider>);
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const text = () => document.body.textContent ?? "";
const button = (label: RegExp) => [...document.querySelectorAll("button")].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
async function click(el: Element | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function chooseFile(bytes: Uint8Array, name: string, type: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([bytes as BlobPart], name, { type });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("/documents", () => {
  it("live: lists database documents and never calls the demo hooks", async () => {
    api.list.mockResolvedValue(page());
    await render(<DocumentsPage />);
    expect(text()).toContain("Aadhaar card");
    expect(text()).toContain("Test Patient");
    expect(text()).toMatch(/only clinicians can open them/); // upload-only notice for clinical files
    expect(button(/Upload/)).toBeTruthy();
    expect(demo.useDocuments).not.toHaveBeenCalled();
  });

  it("live: a 403 is shown as 'not available', not as an empty list", async () => {
    api.list.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "No"));
    await render(<DocumentsPage />);
    expect(text()).toMatch(/Documents aren.t available to you/);
  });

  it("live: storage not configured hides upload and says so", async () => {
    api.list.mockResolvedValue(page({ storageConfigured: false }));
    await render(<DocumentsPage />);
    expect(text()).toMatch(/storage isn.t set up/);
    expect(button(/^Upload$/)).toBeUndefined();
  });

  it("demo mode keeps the mock screen", async () => {
    await render(<DocumentsPage />, false);
    expect(demo.useDocuments).toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("upload dialog (patient Documents tab)", () => {
  const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

  it("rejects a disguised file in the browser and never sends it", async () => {
    api.listForPatient.mockResolvedValue(page({ items: [], canUploadClinical: false }));
    await render(<LivePatientDocuments patientId="p1" />);
    await click(button(/Upload/));
    await chooseFile(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]), "invoice.pdf", "application/pdf");
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/Only PDF, JPEG and PNG/);
    expect(button(/^Upload$/)?.disabled).toBe(true);
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("uploads a valid file with the chosen fields and reports progress", async () => {
    api.listForPatient.mockResolvedValue(page({ items: [], canUploadClinical: false }));
    api.upload.mockImplementation(async (_input: unknown, onProgress?: (f: number) => void) => {
      onProgress?.(0.5);
      return { id: "new", category: "ID_PROOF", labReportId: null, readable: true };
    });
    await render(<LivePatientDocuments patientId="p1" />);
    await click(button(/Upload/));
    await chooseFile(PNG, "aadhaar.png", "image/png");
    await click(button(/^Upload$/));
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload.mock.calls[0][0]).toMatchObject({ patientId: "p1", category: "ID_PROOF", title: "aadhaar" });
  });
});

describe("/reports (lab reports)", () => {
  it("upload-only roles get an 'add results' panel and no report list", async () => {
    api.labList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 15, canCreate: true, canView: false } satisfies LabReportPage);
    await render(<ReportsPage />);
    expect(text()).toContain("Only clinicians can open lab reports.");
    expect(button(/Add result/)).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
    expect(demo.useReports).not.toHaveBeenCalled();
  });

  it("detail shows real actions only — no fake download, print or AI panel", async () => {
    const detail: LiveLabReportDetail = {
      id: "r1", patientId: "p1", patientName: "Test Patient", patientNumber: "AAR-P-1", branch: { id: "b1", name: "Kothrud" }, testType: "CBC", title: "CBC result",
      status: "AVAILABLE", resultDate: "2026-10-13", orderedBy: { id: "d1", name: "Dr. Test" }, consultationId: null, reviewedAt: null, reviewedByName: null, sharedWithPatientAt: null,
      valueCount: 1, createdAt: "2026-10-13T05:00:00.000Z", updatedAt: "2026-10-13T05:00:00.000Z",
      values: [{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }], notes: null, attachments: [],
      actions: { canEditValues: true, canReview: true, canShare: false, canAttach: true },
    };
    api.labGet.mockResolvedValue(detail);
    await render(<LiveLabReportDetail id="r1" />);
    expect(text()).toContain("Hb");
    expect(button(/Mark reviewed/)).toBeTruthy();
    expect(button(/Share with patient/)).toBeUndefined();
    for (const fake of [/^Download$/, /Print/, /Explain Report/]) expect(button(fake)).toBeUndefined();
    expect(demo.useReport).not.toHaveBeenCalled();
  });

  it("detail: a report the user may not see is shown as an error, not demo data", async () => {
    api.labGet.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "Not found."));
    await render(<LiveLabReportDetail id="r404" />);
    expect(text()).toMatch(/Couldn.t load lab reports/i);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiGet, apiPost, toQuery } from "./api-client";
import { isLiveRoute, LIVE_ROUTE_PREFIXES } from "./data-source";

const SRC = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
function files(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) out.push(...files(f, re));
    else if (re.test(e)) out.push(f);
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client: errors are thrown, never replaced", () => {
  it("builds query strings from defined, non-empty values", () => {
    expect(toQuery({ a: "x", b: undefined, c: "", d: 0, e: "all" })).toBe("?a=x&d=0&e=all");
    expect(toQuery({})).toBe("");
  });

  it("throws the server's error code and message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "SLOT_TAKEN", message: "Taken" } }), { status: 409 })));
    await expect(apiPost("/api/v1/appointments", {})).rejects.toMatchObject({ name: "ApiRequestError", status: 409, code: "SLOT_TAKEN", message: "Taken" });
  });

  it("reports network failures as errors (no offline/mock fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(apiGet("/api/v1/patients")).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(apiGet("/api/v1/patients", { search: "x" })).resolves.toEqual({ items: [] });
  });
});

describe("no silent fallback to mock data", () => {
  it("the live API module never imports the mock store or mock service code", () => {
    const src = read("lib/live-api.ts");
    expect(src).not.toMatch(/from "@\/store\//);
    for (const m of src.matchAll(/^import\s+(type\s+)?[^;]*from "@\/services\/[^"]+";/gm)) expect(m[1], m[0]).toBe("type ");
  });

  it("every migrated hook chooses its source explicitly from the live flag", () => {
    for (const hook of ["hooks/use-patients.ts", "hooks/use-appointments.ts", "hooks/use-people.ts", "hooks/use-search.ts", "hooks/use-availability.ts", "hooks/use-branches.ts", "hooks/use-billing.ts", "hooks/use-clinical.ts", "hooks/use-inventory.ts"]) {
      const src = read(hook);
      expect(src, hook).toContain("useLiveData()");
      expect(src, hook).toMatch(/live \?/);
    }
  });

  it("every /api/v1 route goes through apiRoute, identityRoute or fileRoute (verified session + JSON errors)", () => {
    const routes = files(path.join(SRC, "app/api/v1"), /^route\.ts$/);
    expect(routes.length).toBeGreaterThanOrEqual(45);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) =/g)].length;
      expect(handlers, f).toBeGreaterThan(0);
      expect([...src.matchAll(/= (apiRoute|identityRoute|fileRoute|patientRoute|patientFileRoute)(<[^>]*>)?\(/g)].length, f).toBe(handlers);
      // identityRoute (no clinic membership required) is only for the signed-in user's own invitations.
      if (/identityRoute/.test(src)) expect(f.replaceAll(path.sep, "/"), f).toMatch(/app\/api\/v1\/me\//);
      // Patient-portal sessions (P6.3) exist only under /api/v1/portal/, and portal routes never accept a staff session.
      const portal = /app\/api\/v1\/portal\//.test(f.replaceAll(path.sep, "/"));
      if (/patientRoute|patientFileRoute/.test(src)) expect(portal, f).toBe(true);
      if (portal) expect(src, f).not.toMatch(/\b(apiRoute|identityRoute|fileRoute)\b/);
      // fileRoute (a download instead of JSON) is only for the audited report export and the audited document file.
      if (/fileRoute/.test(src)) expect(f.replaceAll(path.sep, "/"), f).toMatch(/app\/api\/v1\/(reports\/export|documents\/\[id\]\/file)\/route\.ts$/);
      expect(src, f).not.toMatch(/from "@\/store\/|from "@\/services\/(?!.*type)/);
    }
  });

  it("server data modules never touch the mock store", () => {
    for (const f of files(path.join(SRC, "server/data"), /\.ts$/)) expect(readFileSync(f, "utf8"), f).not.toMatch(/@\/store\/|getDb\(/);
  });
});

describe("live screens never show demo data (P5)", () => {
  // Files that render in the live staff app. They may read the demo store only
  // behind an explicit live check (selector returns an empty constant when live).
  const LIVE_SCREENS = [
    "app/(app)/staff/page.tsx",
    "app/(app)/doctor-roster/page.tsx",
    "app/(app)/doctor-roster/[id]/page.tsx",
    "app/(app)/notifications/page.tsx",
    "app/(app)/waiting-room/page.tsx",
    "components/layout/notifications-menu.tsx",
    "components/layout/app-sidebar.tsx",
    "components/notifications/live-notifications.tsx",
    "components/staff/invite-staff-dialog.tsx",
    "components/staff/invitations-panel.tsx",
    "components/invitations/pending-invitations.tsx",
    "components/patients/patient-header.tsx",
    "components/patients/start-consultation-button.tsx",
    "components/analytics/live-reports.tsx",
    "components/analytics/trend-bar-chart.tsx",
  ];

  it("live screens read the demo store only behind a live check", () => {
    for (const f of LIVE_SCREENS) {
      const src = read(f);
      for (const m of src.matchAll(/useDataStore\(\(s\) => (.+)\)/g)) {
        if (/s\.db\.(doctors|staff|notifications|patients|users)/.test(m[1])) expect(m[1], `${f}: ${m[0]}`).toMatch(/^\(?live \? NO_|!live/);
      }
      expect(src, f).not.toMatch(/getDb\(\)/);
    }
  });

  it("live reports (P6.1) never import the demo store or mock services", () => {
    for (const f of ["components/analytics/live-reports.tsx", "components/analytics/trend-bar-chart.tsx", "hooks/use-reports.ts"]) {
      expect(read(f), f).not.toMatch(/@\/store\/|getDb\(|from "@\/services\/(?!.*type)/);
    }
    // The page picks its source explicitly.
    expect(read("app/(app)/analytics/page.tsx")).toMatch(/useLiveData\(\) \? <LiveReports \/> : <DemoAnalytics \/>/);
  });

  it("the hard-coded demo lists don't feed live filters", () => {
    expect(read("app/(app)/doctor-roster/page.tsx")).not.toMatch(/SPECIALIZATIONS/);
    expect(read("app/(app)/staff/page.tsx")).toMatch(/const LIVE_ROLES/);
  });

  it("notification hooks pick their source explicitly and never fall back to the demo store", () => {
    const src = read("hooks/use-notifications.ts");
    expect(src).toContain("useLiveData()");
    expect(src).toContain("isSupabaseAuthEnabled()");
    // Every demo-store query is disabled unless the source is "mock".
    const mockQueries = src.split(/\nexport function /).filter((block) => /queryFn: \(\) => (listNotifications|getUnreadCount)\(/.test(block));
    expect(mockQueries.length).toBe(2);
    for (const q of mockQueries) expect(q, q.slice(0, 40)).toMatch(/enabled: source === "mock"/);
  });

  it("the legacy credentials dialog and password-mail hook are only reachable from demo-only dialogs", () => {
    const users = files(SRC, /\.(ts|tsx)$/)
      .filter((f) => !f.includes(`${path.sep}generated${path.sep}`) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /from "@\/components\/shared\/credentials-dialog"|from "@\/hooks\/use-notify-new-account"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).replaceAll(path.sep, "/"))
      .sort();
    expect(users).toEqual(["components/doctors/doctor-form-dialog.tsx", "components/shared/credentials-dialog.tsx", "components/staff/staff-form-dialog.tsx"]);
    for (const f of ["components/doctors/doctor-form-dialog.tsx", "components/staff/staff-form-dialog.tsx"]) expect(read(f), f).toMatch(/return live \? null :/);
  });

  it("/clinic/users shows the database's users with live data (never the demo users)", () => {
    expect(read("app/(app)/clinic/users/page.tsx")).toMatch(/useLiveData\(\) \? <LiveClinicUsers \/> : <DemoClinicUsersPage \/>/);
  });
});

describe("the Supabase secret stays on the server", () => {
  it("SUPABASE_SECRET_KEY is read only by server-only modules, and no public variable carries a secret", () => {
    for (const f of files(SRC, /\.(ts|tsx)$/)) {
      if (f.includes(`${path.sep}generated${path.sep}`) || /\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      // Any READ of the variable (env.X / env["X"]) must be in a server-only module.
      // The bare name may appear in help text (e.g. "set SUPABASE_SECRET_KEY in .env.local").
      if (/\benv\s*(\.\s*SUPABASE_SECRET_KEY|\[\s*["'`]SUPABASE_SECRET_KEY)/.test(src)) {
        expect(src.trimStart().startsWith('import "server-only";'), f).toBe(true);
        expect(src, f).not.toMatch(/^"use client"/m);
      }
      expect(src, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE)/);
    }
    const env = readFileSync(path.join(SRC, "../.env.example"), "utf8");
    expect(env).toMatch(/^SUPABASE_SECRET_KEY=$/m); // name only, never a value
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE)/);
  });
});

describe("patient documents (P6.2): storage is reachable only through the authorized server module", () => {
  const STORAGE_MODULE = "server/storage/documents.ts";
  const sources = () =>
    files(SRC, /\.(ts|tsx)$/)
      .filter((f) => !f.includes(`${path.sep}generated${path.sep}`) && !/\.test\.tsx?$/.test(f))
      .map((f) => ({ rel: path.relative(SRC, f).replaceAll(path.sep, "/"), src: readFileSync(f, "utf8") }));

  it("only the storage module uses Supabase Storage or names the bucket", () => {
    for (const { rel, src } of sources()) {
      if (rel === STORAGE_MODULE) continue;
      expect(src, rel).not.toMatch(/\.storage\s*\.\s*from\(|\.storage(?!Key)|["'`]patient-documents["'`]|createSignedUrl|getPublicUrl/);
    }
    const mod = read(STORAGE_MODULE);
    expect(mod.trimStart().startsWith('import "server-only";')).toBe(true);
    expect(mod).not.toMatch(/createSignedUrl|getPublicUrl|\.remove\(/); // no signed/public URLs, no deletes in the request path
  });

  it("only the documents data module imports the storage module", () => {
    const importers = sources().filter(({ src }) => /from "@\/server\/storage\/documents"/.test(src)).map(({ rel }) => rel);
    expect(importers).toEqual(["server/data/documents.ts"]);
  });

  it("every storage read/write is handed an authorization token built from a database row", () => {
    const src = read("server/data/documents.ts");
    const reads = [...src.matchAll(/readDocument\(([^,]+),/g)].map((m) => m[1].trim());
    const writes = [...src.matchAll(/writeDocument\(([^,]+),/g)].map((m) => m[1].trim());
    expect(reads).toEqual(["authorizedDocument(clinicId"]); // the single verified fetch shared by staff and portal downloads
    // Each caller hands it a row it read through RLS in the caller's own transaction.
    expect([...src.matchAll(/await fetchVerified\(([^,]+),\s*(\w+)/g)].map((m) => `${m[1]},${m[2]}`)).toEqual(["ctx.clinicId,row", "ctx.clinicId,row"]);
    expect(writes).toEqual(["reg.upload"]);
    expect(src).toMatch(/upload: registeredUpload\(ctx\.clinicId, rows\[0\]\)/);
    // The view is audited (and committed) before any bytes are fetched.
    expect(src.indexOf('"document.viewed"')).toBeLessThan(src.indexOf("readDocument("));
  });

  it("live document and lab-report screens never import the demo store or mock services", () => {
    for (const f of [
      "components/documents/live-documents.tsx",
      "components/documents/document-list.tsx",
      "components/documents/upload-document-dialog.tsx",
      "components/lab-reports/live-lab-reports.tsx",
      "components/lab-reports/live-lab-report-detail.tsx",
      "components/lab-reports/consultation-lab-results.tsx",
      "hooks/use-documents.ts",
    ]) {
      expect(read(f), f).not.toMatch(/@\/store\/|getDb\(|from "@\/services\/(?!.*type)|@\/hooks\/use-clinical|@\/hooks\/use-ai/);
    }
    expect(read("app/(app)/reports/page.tsx")).toMatch(/useLiveData\(\) \? <LiveLabReports \/> : <DemoReportsPage \/>/);
    expect(read("app/(app)/reports/[id]/page.tsx")).toMatch(/useLiveData\(\) \? <LiveLabReportDetail id=\{id\} \/> : <DemoReportDetail id=\{id\} \/>/);
    expect(read("app/(app)/documents/page.tsx")).toMatch(/useLiveData\(\) \? <LiveDocuments \/> : <DemoDocumentsPage \/>/);
    const patient = read("app/(app)/patients/[id]/page.tsx");
    expect(patient).toMatch(/live \? <LivePatientLabReports/);
    expect(patient).toMatch(/live \? <LivePatientDocuments/);
  });
});

describe("patient portal (P6.3): live data only, scoped by the server", () => {
  it("the portal download audits (and commits) before it fetches, and only through the shared verified fetch", () => {
    const src = read("server/data/documents.ts");
    const body = src.slice(src.indexOf("export async function openPatientDocumentFile"));
    expect(body.indexOf('"document.viewed"')).toBeGreaterThan(0);
    expect(body.indexOf('"document.viewed"')).toBeLessThan(body.indexOf("fetchVerified("));
    expect(body).toMatch(/runPatientScoped\(ctx, db/); // the patient's own RLS-scoped transaction, never a staff one
  });

  it("portal data never takes a patient id from the request and always repeats the eligibility rule", () => {
    const src = read("server/data/portal.ts");
    expect(src).not.toMatch(/patientId:\s*(input|raw|params|request)/);
    expect(src).toMatch(/status: "REVIEWED", sharedWithPatientAt: \{ not: null \}/);
    expect(src).toMatch(/category: "LAB_REPORT", status: "AVAILABLE"/);
    for (const f of [
      "app/api/v1/portal/lab-reports/route.ts", "app/api/v1/portal/documents/route.ts", "app/api/v1/portal/summary/route.ts",
      "app/api/v1/portal/dashboard/route.ts", "app/api/v1/portal/appointments/route.ts", "app/api/v1/portal/appointments/[id]/route.ts",
      "app/api/v1/portal/appointments/[id]/cancel/route.ts", "app/api/v1/portal/appointments/[id]/reschedule/route.ts",
      "app/api/v1/portal/booking-options/route.ts", "app/api/v1/portal/slots/route.ts", "app/api/v1/portal/invoices/route.ts", "app/api/v1/portal/record/route.ts",
    ]) {
      expect(read(f), f).not.toMatch(/patientId/);
    }
  });

  it("live portal screens never import the demo store or mock services, and the pages pick their source explicitly", () => {
    for (const f of ["components/portal/live-portal.tsx", "components/portal/live-portal-care.tsx", "hooks/use-portal.ts"]) {
      expect(read(f), f).not.toMatch(/@\/store\/|getDb\(|from "@\/services\/(?!.*type)|@\/hooks\/use-clinical|@\/hooks\/use-ai|useCurrentUser|patientId/);
    }
    expect(read("app/(portal)/portal/page.tsx")).toMatch(/useLiveData\(\) \? <LivePortalHome \/> : <DemoPortalHomePage \/>/);
    expect(read("app/(portal)/portal/reports/page.tsx")).toMatch(/useLiveData\(\) \? <LivePortalReports \/> : <DemoPortalReportsPage \/>/);
    expect(read("app/(portal)/portal/reports/[id]/page.tsx")).toMatch(/useLiveData\(\) \? <LivePortalReportDetail id=\{id\} \/> : <DemoPortalReportDetail id=\{id\} \/>/);
    expect(read("app/(portal)/portal/documents/page.tsx")).toMatch(/useLiveData\(\) \? <LivePortalDocuments \/> : <DemoPortalDocumentsPage \/>/);
  });
});

describe("patient onboarding (P6.4): codes link existing records; nothing else does", () => {
  it("a login with no application account is sent to the linking-code page, from staff and portal routes alike", () => {
    const src = read("server/auth/session.ts");
    expect(src.match(/err\.code === "NOT_PROVISIONED"\) redirect\(LINK_ACCOUNT_PATH\)/g)?.length).toBe(2);
    expect(read("lib/auth/routes.ts")).toMatch(/IDENTITY_PREFIXES: readonly string\[\] = \["\/invitations", "\/link-account"\]/);
  });

  it("redemption pins only the Supabase identity and passes only the code and the server-verified email", () => {
    const src = read("server/data/patient-link.ts");
    const body = src.slice(src.indexOf("export async function redeemPortalLinkCode"), src.indexOf("function selfRegistrationClinic"));
    expect(body).toMatch(/set_config\('app\.auth_user_id', \$\{authUser\.id\}, true\), set_config\('app\.user_id', '', true\)/);
    expect(body).toMatch(/app\.redeem_patient_link_code\(\$\{code\}, \$\{authUser\.email!/);
    expect(body).toMatch(/redeemLinkCodeSchema\.parse\(input\)/);
    const action = read("app/link-account/actions.ts");
    expect(action).toMatch(/requireAuthUser\(\)/);
    expect(action).not.toMatch(/patientId|input\.clinicId|\.email\s*=/);
  });

  it("existing records are never linked by email: the app only redeems codes or registers a NEW record", () => {
    for (const f of ["server/data/patient-link.ts", "app/link-account/actions.ts", "app/link-account/page.tsx"]) {
      expect(read(f), f).not.toMatch(/link_patient_by_email/);
    }
    const src = read("server/data/patient-link.ts");
    const body = src.slice(src.indexOf("export async function registerSelfPatient"));
    // The clinic comes from the server setting; the patient never chooses it.
    expect(body).toMatch(/app\.register_self_patient\(\$\{selfRegistrationClinic\(\)\}, \$\{authUser\.email!/);
    expect(read("app/link-account/page.tsx")).not.toMatch(/patientId|searchParams|clinicId/);
  });

  it("the issued code is never logged, stored client-side or audited by the app", () => {
    for (const f of ["server/data/patient-link.ts", "components/patients/portal-link-card.tsx", "hooks/use-portal-link.ts", "app/link-account/link-account-form.tsx"]) {
      expect(read(f), f).not.toMatch(/console\.|localStorage|sessionStorage|recordAuditEvent/);
    }
  });
});

describe("live API calls resolve", () => {
  it("every liveApi.x(.y)(…) call in the source exists on the client and is a function", async () => {
    // Guards against callers and the client drifting apart (e.g. a removed liveApi.medicines still being called).
    const { liveApi } = await import("./live-api");
    const calls = new Set<string>();
    for (const f of files(SRC, /\.(ts|tsx)$/)) {
      if (f.includes(`${path.sep}generated${path.sep}`) || /\.test\.tsx?$/.test(f)) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/\bliveApi((?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)) calls.add(m[1].slice(1));
    }
    expect(calls.size).toBeGreaterThan(20);
    for (const call of calls) {
      const target = call.split(".").reduce<unknown>((obj, key) => (obj as Record<string, unknown> | undefined)?.[key], liveApi);
      expect(typeof target, `liveApi.${call}`).toBe("function");
    }
    expect(calls.has("medicines")).toBe(false);
    expect(calls.has("catalog.search") && calls.has("catalog.create")).toBe(true);
  });
});

describe("live route list", () => {
  it("marks only database-backed staff routes as live", () => {
    expect(isLiveRoute("/patients/abc")).toBe(true);
    expect(isLiveRoute("/appointments")).toBe(true);
    expect(isLiveRoute("/billing/abc")).toBe(true);
    expect(isLiveRoute("/consultations/abc")).toBe(true);
    expect(isLiveRoute("/inventory/branch/medicine")).toBe(true);
    expect(isLiveRoute("/notifications")).toBe(true);
    // Clinic admin (P7): expenses table, setup screens, audit log, plan & usage, settings.
    for (const p of ["/expenses", "/clinic/branches", "/clinic/departments", "/clinic/lab-tests", "/clinic/specialties", "/clinic/users", "/audit-log", "/subscription", "/settings"]) expect(isLiveRoute(p), p).toBe(true);
    // Still demo data in live mode (custom roles and the demo dashboard).
    for (const p of ["/clinic/settings/roles", "/clinic/dashboard", "/ai-assistant"]) expect(isLiveRoute(p), p).toBe(false);
    expect(isLiveRoute("/reports/abc")).toBe(true); // lab reports (P6.2)
    expect(isLiveRoute("/documents")).toBe(true); // patient documents (P6.2)
    expect(isLiveRoute("/patientsx")).toBe(false);
    expect(LIVE_ROUTE_PREFIXES).toContain("/dashboard");
  });
});

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
      expect([...src.matchAll(/= (apiRoute|identityRoute|fileRoute)(<[^>]*>)?\(/g)].length, f).toBe(handlers);
      // identityRoute (no clinic membership required) is only for the signed-in user's own invitations.
      if (/identityRoute/.test(src)) expect(f.replaceAll(path.sep, "/"), f).toMatch(/app\/api\/v1\/me\//);
      // fileRoute (a download instead of JSON) is only for the audited report export.
      if (/fileRoute/.test(src)) expect(f.replaceAll(path.sep, "/"), f).toMatch(/app\/api\/v1\/reports\/export\/route\.ts$/);
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

  it("/clinic/users redirects to /staff with live data", () => {
    expect(read("app/(app)/clinic/users/layout.tsx")).toMatch(/isSupabaseAuthEnabled\(\)\) redirect\("\/staff"\)/);
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
    expect(isLiveRoute("/expenses")).toBe(false); // no expenses table yet
    expect(isLiveRoute("/reports")).toBe(false); // lab reports: later phase
    expect(isLiveRoute("/patientsx")).toBe(false);
    expect(LIVE_ROUTE_PREFIXES).toContain("/dashboard");
  });
});

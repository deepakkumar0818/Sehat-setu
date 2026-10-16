import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BURST_RULES,
  BurstDetector,
  isDatabaseUnavailable,
  monitoringStatus,
  reportEvent,
  reportServerError,
  resetMonitoringForTests,
  sanitizeScope,
  setMonitoringSink,
  type MonitorEvent,
} from "./monitoring";

// Monitoring must never carry patient or account data. Fixtures are fictional ("ZZTEST").
const PHONE = "+919800000001";
const EMAIL = "zztest.patient@example.com";
const UUID = "5e1c0d2a-1111-4222-8333-944455556666";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ6enRlc3QifQ.c2lnbmF0dXJl";
const SECRETS = [PHONE, "9800000001", EMAIL, "ZZTEST", "diabetes", TOKEN, "sb_secret_zztest123", "hunter2", "203.0.113.7", UUID];

let events: MonitorEvent[] = [];
let clock = 0;

beforeEach(() => {
  clock = Date.parse("2026-10-14T10:00:00Z");
  resetMonitoringForTests(() => clock);
  events = [];
  setMonitoringSink({ name: "test", capture: (e) => void events.push(e) });
});
afterEach(() => {
  resetMonitoringForTests();
  vi.restoreAllMocks();
  delete process.env.SEHAT_MONITORING;
});

const emitted = () => JSON.stringify(events);
const leaks = () => SECRETS.filter((s) => emitted().includes(s));

describe("events carry no personal data, secrets or raw database messages", () => {
  it("database errors are reduced to codes", () => {
    const pg = Object.assign(new Error(`violates check constraint\nDETAIL: Failing row contains (${UUID}, ZZTEST Patient, ${PHONE}, ${EMAIL}, diabetes).`), { name: "DatabaseError", code: "23514" });
    const prisma = Object.assign(new Error(`Argument \`phone\`: provided "${PHONE}" for ZZTEST`), { name: "PrismaClientValidationError" });
    reportServerError(`api POST /api/v1/patients`, pg);
    reportServerError(`api POST /api/v1/patients`, prisma);
    expect(leaks(), emitted()).toEqual([]);
    expect(events[0]).toMatchObject({ category: "server_error", severity: "error", status: 500, error: { kind: "DatabaseError", code: "23514" } });
    expect(emitted()).not.toMatch(/Failing row|DETAIL/);
  });

  it("scopes are route templates: ids, query strings, emails and numbers are masked", () => {
    expect(sanitizeScope(`/portal/reports/${UUID}?q=${EMAIL}`)).toBe("/portal/reports/[id]");
    expect(sanitizeScope(`/patients/98000000011/edit`)).toBe("/patients/[id]/edit");
    reportEvent("access_denied", { scope: `GET /patients/${UUID}?phone=${PHONE}`, reason: "FORBIDDEN", status: 403 });
    expect(events[0]).toMatchObject({ category: "access_denied", scope: "GET /patients/[id]", reason: "FORBIDDEN", status: 403 });
    expect(leaks()).toEqual([]);
  });

  it("free text, unknown fields and invalid values are dropped", () => {
    reportEvent("auth_failure", {
      scope: "sign_in",
      reason: `invalid credentials for ${EMAIL}`, // not a code → "other"
      status: 9999,
      // Not part of the event shape — must never be forwarded.
      ...({ email: EMAIL, userId: UUID, ip: "203.0.113.7", password: "hunter2", body: { phone: PHONE }, token: TOKEN } as object),
    } as Parameters<typeof reportEvent>[1]);
    expect(events[0]).toEqual({ category: "auth_failure", severity: "info", scope: "sign_in", reason: "other", at: expect.any(String) });
    expect(leaks()).toEqual([]);
  });

  it("secrets inside ordinary error messages are redacted", () => {
    reportServerError("auth", new Error(`fetch failed postgresql://postgres:hunter2@203.0.113.7:5432/db key sb_secret_zztest123 token ${TOKEN} for ${EMAIL}`));
    expect(leaks(), emitted()).toEqual([]);
  });
});

describe("classification", () => {
  it.each([
    ["Prisma can't reach the database", { name: "PrismaClientInitializationError", code: "P1001" }],
    ["pool timeout", { name: "PrismaClientKnownRequestError", code: "P2024" }],
    ["connection refused", { name: "Error", code: "ECONNREFUSED" }],
    ["SQLSTATE 08006", { name: "PrismaClientKnownRequestError", code: "P2010", meta: { code: "08006" } }],
    ["too many connections", { name: "PrismaClientKnownRequestError", code: "P2010", meta: { code: "53300" } }],
  ])("%s → db_unavailable (critical)", (_l, shape) => {
    const err = Object.assign(new Error("x"), shape);
    expect(isDatabaseUnavailable(err)).toBe(true);
    reportServerError("api GET /api/v1/patients", err);
    expect(events[0]).toMatchObject({ category: "db_unavailable", severity: "critical" });
  });

  it("a unique violation is an ordinary server error", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P2002" }))).toBe(false);
  });
});

describe("burst alerts (per instance)", () => {
  it("one audit-write failure raises a critical alert", () => {
    reportEvent("audit_write_failed", { scope: "auth.sign_in", error: new Error("insert failed") });
    expect(events.map((e) => e.category)).toEqual(["audit_write_failed", "alert"]);
    expect(events[1]).toMatchObject({ severity: "critical", scope: "burst audit_write_failed", burst: { category: "audit_write_failed", count: 1, windowSeconds: 300 } });
  });

  it("access denials alert at the threshold, once per window, and again after it", () => {
    const rule = BURST_RULES.access_denied!;
    for (let i = 0; i < rule.count - 1; i++) reportEvent("access_denied", { scope: "/billing", reason: "FORBIDDEN" });
    expect(events.filter((e) => e.category === "alert")).toHaveLength(0);
    reportEvent("access_denied", { scope: "/billing", reason: "FORBIDDEN" });
    for (let i = 0; i < 20; i++) reportEvent("access_denied", { scope: "/billing", reason: "FORBIDDEN" });
    expect(events.filter((e) => e.category === "alert")).toHaveLength(1);
    clock += rule.windowSeconds * 1000 + 1;
    for (let i = 0; i < rule.count; i++) reportEvent("access_denied", { scope: "/billing", reason: "FORBIDDEN" });
    expect(events.filter((e) => e.category === "alert")).toHaveLength(2);
  });

  it("events spread out over time don't alert, and memory stays bounded", () => {
    const d = new BurstDetector({ auth_failure: { count: 3, windowSeconds: 60, severity: "warning" } });
    expect(d.record("auth_failure", 0)).toBeNull();
    expect(d.record("auth_failure", 61_000)).toBeNull();
    expect(d.record("auth_failure", 122_000)).toBeNull();
    expect(d.record("auth_failure", 123_000)).toBeNull();
    expect(d.record("auth_failure", 124_000)).toEqual({ rule: { count: 3, windowSeconds: 60, severity: "warning" }, count: 3 });
    for (let i = 0; i < 10_000; i++) d.record("auth_failure", 200_000 + i);
    expect((d as unknown as { seen: Map<string, number[]> }).seen.get("auth_failure")!.length).toBeLessThanOrEqual(3);
  });
});

describe("sinks", () => {
  it("default is none: nothing is captured and monitoring reports itself inactive", () => {
    resetMonitoringForTests();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(monitoringStatus()).toEqual({ sink: "none", active: false });
    reportServerError("api GET /x", new Error("boom"));
    expect(log).not.toHaveBeenCalled();
  });

  it("SEHAT_MONITORING=console writes one sanitised JSON line per event", () => {
    resetMonitoringForTests();
    process.env.SEHAT_MONITORING = "console";
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(monitoringStatus()).toEqual({ sink: "console", active: true });
    reportEvent("access_denied", { scope: `/patients/${UUID}`, reason: "FORBIDDEN" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[monitor\] \{"category":"access_denied"/);
    expect(String(log.mock.calls[0][0])).not.toContain(UUID);
  });

  it("a failing provider never breaks the request", async () => {
    setMonitoringSink({ name: "broken", capture: () => { throw new Error("provider down"); } });
    expect(() => reportServerError("api GET /x", new Error("boom"))).not.toThrow();
    setMonitoringSink({ name: "rejecting", capture: () => Promise.reject(new Error("provider down")) });
    expect(() => reportEvent("auth_failure", { scope: "sign_in", reason: "invalid_credentials" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });
});

describe("hooks are wired, and never pass identifiers", () => {
  const SRC = path.resolve(import.meta.dirname, "..");
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

  it.each([
    ["server/api/route-handler.ts", /reportServerError\(`api \$\{resource\}`, err\)/],
    ["server/auth/http.ts", /reportServerError\("auth", err\)/],
    ["server/audit.ts", /reportEvent\("audit_write_failed", \{ scope: event\.action, error: err \}\)/],
    ["server/auth/session.ts", /reportEvent\("access_denied", \{ scope: resource, reason: err\.code, status: err\.status \}\)/],
    ["app/login/actions.ts", /if \(!result\.ok\) reportEvent\("auth_failure", \{ scope: "sign_in", reason: result\.error \}\)/],
    ["app/link-account/actions.ts", /reportEvent\("link_code_failure", \{ scope: "link_code_redeem", reason: result \}\)/],
    ["app/link-account/page.tsx", /reportEvent\("link_code_failure", \{ scope: "auto_register", reason: result \}\)/],
    ["instrumentation.ts", /reportServerError\(`\$\{context\.routeType\} \$\{method\} \$\{context\.routePath\}`, err\)/],
  ])("%s", (rel, re) => {
    const src = read(rel);
    expect(src).toMatch(re);
    for (const call of src.matchAll(/report(?:Event|ServerError)\(([^;]*)\);/g)) {
      expect(call[1], `${rel}: ${call[1]}`).not.toMatch(/email|userId|authUserId|actorLabel|ip\b|headers|request\.path|password|code:\s*code/i);
    }
  });
});

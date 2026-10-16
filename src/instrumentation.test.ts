import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetMonitoringForTests, setMonitoringSink, type MonitorEvent } from "@/server/monitoring";
import { onRequestError } from "./instrumentation";

// Next.js passes the request path (with query string) and headers to
// onRequestError. Only the route TEMPLATE may be reported.
const EMAIL = "zztest.patient@example.com";
const UUID = "5e1c0d2a-1111-4222-8333-944455556666";

let events: MonitorEvent[] = [];
beforeEach(() => {
  resetMonitoringForTests();
  events = [];
  setMonitoringSink({ name: "test", capture: (e) => void events.push(e) });
});
afterEach(() => resetMonitoringForTests());

describe("onRequestError", () => {
  it("reports the route template, method and type — never the path, query, headers or raw message", async () => {
    const err = Object.assign(new Error(`Failing row contains (ZZTEST, ${EMAIL})`), { name: "DatabaseError", code: "23505", digest: "123" });
    await onRequestError(
      err,
      { path: `/portal/reports/${UUID}?q=${encodeURIComponent(EMAIL)}`, method: "GET", headers: { cookie: "sb-access-token=zztest-secret", "x-forwarded-for": "203.0.113.7" } },
      { routerKind: "App Router", routePath: "/(portal)/portal/reports/[id]", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined }
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ category: "server_error", scope: "render GET /(portal)/portal/reports/[id]", error: { kind: "DatabaseError", code: "23505" } });
    const out = JSON.stringify(events);
    for (const s of [EMAIL, UUID, "ZZTEST", "zztest-secret", "203.0.113.7", "Failing row"]) expect(out).not.toContain(s);
  });
});

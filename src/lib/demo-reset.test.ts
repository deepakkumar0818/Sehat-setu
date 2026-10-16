import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "Reset demo data": demo mode only, never for patients, and unreachable from
// any server route or action (it only ever regenerated the browser's own
// demo dataset; clinic data can't be reset from the app at all).

const cfg = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/auth/config", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/config")>()), isSupabaseAuthEnabled: () => cfg.enabled }));

const { canResetDemoData } = await import("./demo-reset");
const { useDataStore } = await import("@/store/data-store");

const SRC = path.resolve(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? (n === "generated" ? [] : files(p)) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

beforeEach(() => {
  cfg.enabled = true;
});

describe("demo data reset", () => {
  it("is offered only in demo mode, and never to patients", () => {
    expect(canResetDemoData("patient", true)).toBe(false);
    expect(canResetDemoData("patient", false)).toBe(false);
    expect(canResetDemoData("clinic_admin", true)).toBe(false); // real sign-in: nothing to reset in the browser
    expect(canResetDemoData("clinic_admin", false)).toBe(true);
    expect(canResetDemoData(undefined, false)).toBe(false);
  });

  it("the store action does nothing with real sign-in", () => {
    const before = useDataStore.getState().db;
    useDataStore.getState().resetDemoData();
    expect(useDataStore.getState().db).toBe(before);
    cfg.enabled = false;
    useDataStore.getState().resetDemoData();
    expect(useDataStore.getState().db).not.toBe(before);
  });

  it("no API route, server action, server module or portal screen can reach it", () => {
    const offenders = files(SRC).filter((f) => {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      const serverSide = rel.startsWith("app/api/") || rel.startsWith("server/") || /actions\.ts$/.test(rel) || rel.startsWith("app/(portal)/") || rel.startsWith("components/portal/");
      return serverSide && /resetDemoData|generateDatabase\(/.test(readFileSync(f, "utf8"));
    });
    expect(offenders).toEqual([]);
    // The only UI entry point checks the rule.
    expect(readFileSync(path.join(SRC, "components/layout/user-menu.tsx"), "utf8")).toMatch(/const canResetDemo = canResetDemoData\(user\.role\);[\s\S]*\{canResetDemo && \(/);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSupabasePublicConfig } from "./config";
import { isProtectedPath, safeNextPath, staffRoutePermissions, STAFF_ROUTE_PERMISSIONS } from "./routes";
import { primaryUserRole } from "./session-user";
import { PERMISSION_CATALOG } from "@/data/permission-catalog";

describe("Supabase public config (missing/invalid env handling)", () => {
  it("disables auth when variables are missing or placeholders", () => {
    expect(parseSupabasePublicConfig({})).toBeNull();
    expect(parseSupabasePublicConfig({ url: "https://abc.supabase.co" })).toBeNull();
    expect(parseSupabasePublicConfig({ publishableKey: "sb_publishable_x" })).toBeNull();
    expect(parseSupabasePublicConfig({ url: "https://abc.supabase.co", publishableKey: "[YOUR-KEY]" })).toBeNull();
    expect(parseSupabasePublicConfig({ url: "https://<project>.supabase.co", publishableKey: "k" })).toBeNull();
    expect(parseSupabasePublicConfig({ url: "not a url", publishableKey: "k" })).toBeNull();
  });

  it("requires HTTPS except on localhost", () => {
    expect(parseSupabasePublicConfig({ url: "http://abc.supabase.co", publishableKey: "k" })).toBeNull();
    expect(parseSupabasePublicConfig({ url: "http://localhost:54321", publishableKey: "k" })).toEqual({ url: "http://localhost:54321", publishableKey: "k" });
    expect(parseSupabasePublicConfig({ url: "https://abc.supabase.co/", publishableKey: " k " })).toEqual({ url: "https://abc.supabase.co", publishableKey: "k" });
  });
});

describe("route protection map", () => {
  const appDir = path.resolve(import.meta.dirname, "../../app/(app)");
  const segments = readdirSync(appDir).filter((d) => statSync(path.join(appDir, d)).isDirectory());

  it("protects every staff route folder with a server-side permission guard", () => {
    for (const seg of segments) {
      const route = `/${seg}`;
      expect(STAFF_ROUTE_PERMISSIONS, `missing permission entry for ${route}`).toHaveProperty([route]);
      const layout = readFileSync(path.join(appDir, seg, "layout.tsx"), "utf8");
      expect(layout, `${route}/layout.tsx must call guardStaffRoute("${route}")`).toContain(`guardStaffRoute("${route}")`);
      expect(isProtectedPath(route)).toBe(true);
    }
  });

  it("guards the root staff layout and portal layout on the server", () => {
    expect(readFileSync(path.join(appDir, "layout.tsx"), "utf8")).toContain("guardStaffRoute(null)");
    expect(readFileSync(path.resolve(appDir, "../(portal)/layout.tsx"), "utf8")).toContain("guardPortalRoute()");
    expect(isProtectedPath("/portal/prescriptions/RX-1")).toBe(true);
  });

  it("only references permission keys that exist in the catalog", () => {
    const known = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const [route, keys] of Object.entries(STAFF_ROUTE_PERMISSIONS)) {
      for (const key of keys) expect(known.has(key), `${route} → unknown permission ${key}`).toBe(true);
    }
  });

  it("uses the most specific prefix and denies unknown paths", () => {
    expect(staffRoutePermissions("/clinic/settings/roles")).toEqual(["role.manage"]);
    expect(staffRoutePermissions("/clinic/branches")).toEqual(STAFF_ROUTE_PERMISSIONS["/clinic"]);
    expect(staffRoutePermissions("/billing/INV-1")).toEqual(STAFF_ROUTE_PERMISSIONS["/billing"]);
    expect(staffRoutePermissions("/billingx")).toBeUndefined();
    expect(staffRoutePermissions("/unknown")).toBeUndefined();
  });

  it("leaves public pages unprotected", () => {
    for (const p of ["/", "/login", "/doctors", "/doctors/DR-1", "/book", "/auth/confirm", "/clinics"]) expect(isProtectedPath(p)).toBe(false);
  });
});

describe("post-login redirect safety", () => {
  it("allows only same-origin relative paths", () => {
    expect(safeNextPath("/patients?x=1")).toBe("/patients?x=1");
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a\r\nSet-Cookie: x"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("UI role from database roles", () => {
  it("picks the broadest staff role", () => {
    expect(primaryUserRole(["NURSE", "ADMINISTRATOR"])).toBe("clinic_admin");
    expect(primaryUserRole(["DOCTOR"])).toBe("doctor");
    expect(primaryUserRole(["PATIENT"])).toBe("patient");
    expect(() => primaryUserRole([])).toThrow();
  });
});

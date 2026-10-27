import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, HSTS, PERMISSIONS_POLICY, securityHeaders } from "./security-headers";

const SUPABASE = "https://abcdefghijklmnop.supabase.co";
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("Content-Security-Policy", () => {
  const prod = contentSecurityPolicy({ isDev: false, supabaseOrigin: SUPABASE });

  it("allows only this origin for scripts, styles, fonts, frames and connections (plus the Supabase project)", () => {
    expect(directive(prod, "default-src")).toBe("default-src 'self'");
    expect(directive(prod, "script-src")).toBe("script-src 'self' 'unsafe-inline'"); // Next.js inline bootstrap; no eval in production
    expect(directive(prod, "connect-src")).toBe(`connect-src 'self' ${SUPABASE}`);
    expect(directive(prod, "img-src")).toBe("img-src 'self' data: blob:"); // document previews are blob: object URLs
    for (const d of ["object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) expect(prod).toContain(d);
    expect(prod).not.toMatch(/\*|https?:\/\/(?!abcdefghijklmnop\.supabase\.co)|unsafe-eval/);
  });

  it("development adds only what React debugging and HMR need", () => {
    const dev = contentSecurityPolicy({ isDev: true, supabaseOrigin: SUPABASE });
    expect(directive(dev, "script-src")).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(directive(dev, "connect-src")).toBe(`connect-src 'self' ${SUPABASE} ws: wss:`);
  });

  it("without Supabase configured, connections stay same-origin", () => {
    expect(directive(contentSecurityPolicy({ isDev: false, supabaseOrigin: null }), "connect-src")).toBe("connect-src 'self'");
  });
});

describe("header rules", () => {
  const rules = securityHeaders({ isDev: false, supabaseOrigin: SUPABASE });
  const pages = rules.find((r) => r.source === "/((?!api/).*)")!;
  const all = rules.find((r) => r.source === "/:path*")!;
  const get = (rule: typeof pages, key: string) => rule.headers.find((h) => h.key === key)?.value;

  it("pages get CSP, frame protection, Referrer-Policy, Permissions-Policy and COOP", () => {
    expect(get(pages, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(get(pages, "X-Frame-Options")).toBe("DENY");
    expect(get(pages, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(pages, "Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    expect(PERMISSIONS_POLICY).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    expect(get(pages, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("API routes are excluded from the page CSP (file downloads keep their own sandbox CSP)", () => {
    const re = /^\/((?!api\/).*)$/;
    expect(re.test("/portal/reports")).toBe(true);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/api/v1/documents/x/file")).toBe(false);
    expect(readFileSync(path.resolve(import.meta.dirname, "../server/api/route-handler.ts"), "utf8")).toMatch(/"Content-Security-Policy": "sandbox;/);
  });

  it("every response gets nosniff; HSTS only from production builds, without includeSubDomains/preload", () => {
    expect(get(all, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(all, "Strict-Transport-Security")).toBe(HSTS);
    expect(HSTS).toBe("max-age=31536000");
    const dev = securityHeaders({ isDev: true, supabaseOrigin: SUPABASE }).find((r) => r.source === "/:path*")!;
    expect(dev.headers.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });

  it("Razorpay origins are allowed only when online payments are configured, and nothing else is opened", () => {
    const off = contentSecurityPolicy({ isDev: false, supabaseOrigin: SUPABASE });
    expect(off).not.toContain("razorpay");
    expect(directive(off, "frame-src")).toBe("frame-src 'none'");
    const on = contentSecurityPolicy({ isDev: false, supabaseOrigin: SUPABASE, razorpay: true });
    expect(directive(on, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://checkout.razorpay.com");
    expect(directive(on, "frame-src")).toBe("frame-src https://api.razorpay.com https://checkout.razorpay.com");
    expect(directive(on, "connect-src")).toBe(`connect-src 'self' ${SUPABASE} https://api.razorpay.com https://lumberjack.razorpay.com`);
    expect(directive(on, "frame-ancestors")).toBe("frame-ancestors 'none'"); // the app itself still can't be framed
    const pages = securityHeaders({ isDev: false, supabaseOrigin: SUPABASE, razorpay: true }).find((r) => r.source !== "/:path*")!;
    const pp = pages.headers.find((h) => h.key === "Permissions-Policy")!.value;
    expect(pp).toContain('payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")');
    expect(pp).toMatch(/camera=\(\).*microphone=\(\)/);
  });

  it("next.config.ts uses these rules and hides X-Powered-By", () => {
    const cfg = readFileSync(path.resolve(import.meta.dirname, "../../next.config.ts"), "utf8");
    expect(cfg).toMatch(/return securityHeaders\(\{ isDev: phase === PHASE_DEVELOPMENT_SERVER/);
    expect(cfg).toMatch(/poweredByHeader: false/);
  });
});

// The policy is only correct while the app keeps the footprint it was built for.
// If one of these fails, update the CSP deliberately (and this test) instead of
// shipping a page the browser will partly block.
describe("the app still fits the policy", () => {
  const SRC = path.resolve(import.meta.dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const f = path.join(dir, e);
      if (statSync(f).isDirectory()) return e === "generated" ? [] : files(f);
      return /\.(tsx?|css)$/.test(e) && !/\.test\.tsx?$/.test(e) ? [f] : [];
    });
  const sources = files(SRC).map((f) => ({ rel: path.relative(SRC, f).replaceAll(path.sep, "/"), src: readFileSync(f, "utf8") }));

  it("no iframes, embeds, workers, eval or media/location APIs", () => {
    const re = /<iframe|<embed|<object|new Worker\(|\beval\(|new Function\(|getUserMedia|navigator\.geolocation/;
    expect(sources.filter((s) => re.test(s.src)).map((s) => s.rel)).toEqual([]);
  });

  it("no third-party scripts, stylesheets, fonts or images", () => {
    const re = /<(script|link|img)[^>]+(src|href)=["']https?:\/\/|@import\s+url\(["']?https?:|fonts\.googleapis\.com/;
    expect(sources.filter((s) => re.test(s.src)).map((s) => s.rel)).toEqual([]);
  });

  it("the only browser-side network client is Supabase Auth (covered by connect-src)", () => {
    const clients = sources.filter((s) => /createSupabaseBrowserClient\(|new WebSocket\(|EventSource\(/.test(s.src)).map((s) => s.rel).sort();
    // Password changes and "sign out everywhere": patient portal and super admin settings.
    expect(clients).toEqual([
      "app/auth/set-password/page.tsx",
      "components/platform/change-password-dialog.tsx",
      "components/platform/platform-settings.tsx",
      "components/portal/live-portal-settings.tsx",
      "lib/supabase/browser.ts",
    ]);
  });
});

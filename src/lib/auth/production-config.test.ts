import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOW_DEMO_BUILD_ENV, productionAuthConfigProblem } from "./config";

// Production builds must fail closed: without the public Supabase values the
// bundles would silently ship the demo-persona login and mock data.

const OK = { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_zztest" };

describe("productionAuthConfigProblem", () => {
  it("passes with valid public Supabase settings (publishable or legacy anon key)", () => {
    expect(productionAuthConfigProblem(OK)).toBeNull();
    expect(productionAuthConfigProblem({ NEXT_PUBLIC_SUPABASE_URL: OK.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJzztest" })).toBeNull();
  });

  it.each([
    ["nothing set", {}],
    ["key missing", { NEXT_PUBLIC_SUPABASE_URL: OK.NEXT_PUBLIC_SUPABASE_URL }],
    ["placeholder values", { NEXT_PUBLIC_SUPABASE_URL: "https://[your-project].supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "<key>" }],
    ["plain http to a remote host", { ...OK, NEXT_PUBLIC_SUPABASE_URL: "http://abcdefghijklmnop.supabase.co" }],
    ["demo flag set to something other than exactly 'true'", { [ALLOW_DEMO_BUILD_ENV]: "1" }],
  ])("refuses: %s", (_label, env) => {
    expect(productionAuthConfigProblem(env)).toMatch(/Refusing to build for production without Supabase Auth/);
  });

  it("allows a deliberate demo deployment only with the explicit flag", () => {
    expect(productionAuthConfigProblem({ [ALLOW_DEMO_BUILD_ENV]: "true" })).toBeNull();
  });

  it("never echoes the configured values in its message", () => {
    const msg = productionAuthConfigProblem({ NEXT_PUBLIC_SUPABASE_URL: "https://[secret-ish]", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "<zztest-key>" })!;
    expect(msg).not.toMatch(/secret-ish|zztest-key/);
  });

  it("next.config.ts enforces it for production builds only (not next dev)", () => {
    const cfg = readFileSync(path.resolve(import.meta.dirname, "../../../next.config.ts"), "utf8");
    expect(cfg).toMatch(/if \(phase === PHASE_PRODUCTION_BUILD\) \{\s+const problem = productionAuthConfigProblem\(process\.env\);\s+if \(problem\) throw new Error\(problem\);/);
  });
});

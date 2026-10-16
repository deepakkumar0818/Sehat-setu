import { describe, expect, it } from "vitest";
import { authCallbackUrl, getSiteUrl, LOCAL_SITE_URL } from "./site-url";

// The origin used in Supabase email links. Development always comes back to
// localhost (never a Vercel URL); production uses only an explicit https origin.

describe("getSiteUrl", () => {
  it("development defaults to http://localhost:3000", () => {
    expect(getSiteUrl({ NODE_ENV: "development" })).toBe(LOCAL_SITE_URL);
    expect(getSiteUrl({ NODE_ENV: "test" })).toBe("http://localhost:3000");
    expect(getSiteUrl({})).toBe("http://localhost:3000");
  });

  it("development keeps a configured local origin (another port, 127.0.0.1)", () => {
    expect(getSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3001" })).toBe("http://localhost:3001");
    expect(getSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000/" })).toBe("http://127.0.0.1:3000");
  });

  it("development never reuses a Vercel or other remote URL (VERCEL_URL is ignored)", () => {
    for (const NEXT_PUBLIC_APP_URL of ["https://sehat-setu-abc123.vercel.app", "https://clinic.example.com", "http://example.com:3000"]) {
      expect(getSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL, VERCEL_URL: "sehat-setu-abc123.vercel.app" })).toBe("http://localhost:3000");
    }
  });

  it("rejects values that aren't a bare origin", () => {
    for (const NEXT_PUBLIC_APP_URL of ["localhost:3000", "http://localhost:3000/app", "http://localhost:3000?x=1", "http://user:pw@localhost:3000", "not a url"]) {
      expect(getSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL })).toBe("http://localhost:3000");
    }
  });

  it("production: only an explicit https origin, never localhost; otherwise null (Supabase's Site URL, unchanged)", () => {
    expect(getSiteUrl({ NODE_ENV: "production" })).toBeNull();
    expect(getSiteUrl({ NODE_ENV: "production", VERCEL_URL: "x.vercel.app" })).toBeNull();
    expect(getSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBeNull();
    expect(getSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://localhost:3000" })).toBeNull();
    expect(getSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://clinic.example.com" })).toBeNull();
    expect(getSiteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://clinic.example.com" })).toBe("https://clinic.example.com");
  });
});

describe("authCallbackUrl", () => {
  it("builds /auth/callback with an encoded same-origin next path", () => {
    expect(authCallbackUrl("/link-account", { NODE_ENV: "development" })).toBe("http://localhost:3000/auth/callback?next=%2Flink-account");
    expect(authCallbackUrl("/auth/set-password", { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://clinic.example.com" })).toBe("https://clinic.example.com/auth/callback?next=%2Fauth%2Fset-password");
  });

  it("never points next off-site, and is null in unconfigured production", () => {
    expect(authCallbackUrl("//evil.example", { NODE_ENV: "development" })).toBe("http://localhost:3000/auth/callback?next=%2F");
    expect(authCallbackUrl("https://evil.example", { NODE_ENV: "development" })).toBe("http://localhost:3000/auth/callback?next=%2F");
    expect(authCallbackUrl("/link-account", { NODE_ENV: "production" })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The email-link callback with Supabase stubbed (no network, no email): the
// code is exchanged through the project's server client (which writes the
// session cookies), every outcome is a redirect to a clean same-origin URL, and
// the code or token never appears in the redirect.

const supa = vi.hoisted(() => ({ exchange: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), fail: false }));
vi.mock("@/server/supabase", () => ({
  createSupabaseServerClient: async () => {
    if (supa.fail) throw new Error("AUTH_NOT_CONFIGURED");
    return { auth: { exchangeCodeForSession: supa.exchange, verifyOtp: supa.verifyOtp, getUser: supa.getUser } };
  },
}));

const { GET } = await import("./route");

const CODE = "6f1c2a77-3b0e-4c55-9d1f-zz0test0code";
const TOKEN = "pkce_zztest0token0hash0000000000";
const call = (query: string) => GET(new NextRequest(`http://localhost:3000/auth/callback${query}`));
const location = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  expect(url.origin).toBe("http://localhost:3000"); // same origin, always
  return `${url.pathname}${url.search}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  supa.fail = false;
  supa.getUser.mockResolvedValue({ data: { user: null } });
});

describe("GET /auth/callback", () => {
  it("exchanges a valid code for a session and continues to the linking-code page", async () => {
    supa.exchange.mockResolvedValueOnce({ data: {}, error: null });
    const res = await call(`?code=${CODE}&next=%2Flink-account`);
    expect(supa.exchange).toHaveBeenCalledWith(CODE);
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/link-account");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).not.toContain(CODE);
  });

  it("defaults next to /link-account and refuses off-site next values", async () => {
    supa.exchange.mockResolvedValue({ data: {}, error: null });
    expect(location(await call(`?code=${CODE}`))).toBe("/link-account");
    expect(location(await call(`?code=${CODE}&next=%2F%2Fevil.example`))).toBe("/link-account");
    expect(location(await call(`?code=${CODE}&next=https%3A%2F%2Fevil.example`))).toBe("/link-account");
  });

  it("a code that can't be exchanged here (other browser, reused): the email is confirmed, so ask to sign in", async () => {
    supa.exchange.mockResolvedValueOnce({ data: {}, error: { code: "flow_state_not_found", message: "x" } });
    const res = await call(`?code=${CODE}&next=%2Flink-account`);
    expect(location(res)).toBe("/login?reason=email_confirmed&next=%2Flink-account");
    expect(res.headers.get("location")).not.toContain(CODE);
  });

  it("…but if this browser already has a confirmed session (link opened twice), carries on", async () => {
    supa.exchange.mockResolvedValueOnce({ data: {}, error: { code: "invalid_grant", message: "x" } });
    supa.getUser.mockResolvedValueOnce({ data: { user: { id: "u", email_confirmed_at: "2026-10-15T00:00:00Z" } } });
    expect(location(await call(`?code=${CODE}`))).toBe("/link-account");
  });

  it("an expired or already-used link reported by Supabase", async () => {
    expect(location(await call(`?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=%2Flink-account`))).toBe(
      "/login?reason=link_expired&next=%2Flink-account"
    );
    expect(location(await call(`?error=server_error`))).toBe("/login?reason=link_invalid&next=%2Flink-account");
    expect(supa.exchange).not.toHaveBeenCalled();
  });

  it("missing or malformed parameters never reach Supabase", async () => {
    for (const q of ["", "?next=%2Flink-account", "?code=", "?code=%3Cscript%3E", `?code=${"a".repeat(600)}`, `?token_hash=${TOKEN}`, `?token_hash=${TOKEN}&type=admin`]) {
      expect(location(await call(q))).toMatch(/^\/login\?reason=link_invalid/);
    }
    expect(supa.exchange).not.toHaveBeenCalled();
    expect(supa.verifyOtp).not.toHaveBeenCalled();
  });

  it("token_hash links (any browser) are verified with verifyOtp", async () => {
    supa.verifyOtp.mockResolvedValueOnce({ error: null });
    const res = await call(`?token_hash=${TOKEN}&type=email&next=%2Flink-account`);
    expect(supa.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: TOKEN });
    expect(location(res)).toBe("/link-account");
    supa.verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired", message: "x" } });
    expect(location(await call(`?token_hash=${TOKEN}&type=email`))).toBe("/login?reason=link_expired&next=%2Flink-account");
  });

  it("password recovery: success goes to set-password; a failure asks for a new reset link", async () => {
    supa.exchange.mockResolvedValueOnce({ data: {}, error: null });
    expect(location(await call(`?code=${CODE}&next=%2Fauth%2Fset-password`))).toBe("/auth/set-password");
    supa.exchange.mockResolvedValueOnce({ data: {}, error: { code: "invalid_grant", message: "x" } });
    expect(location(await call(`?code=${CODE}&next=%2Fauth%2Fset-password`))).toBe("/login?reason=reset_link_invalid");
    expect(location(await call(`?error_code=otp_expired&next=%2Fauth%2Fset-password`))).toBe("/login?reason=reset_link_invalid");
  });

  it("Supabase not configured or throwing: a safe error redirect", async () => {
    supa.fail = true;
    expect(location(await call(`?code=${CODE}`))).toBe("/login?reason=link_invalid");
    supa.fail = false;
    supa.exchange.mockRejectedValueOnce(new Error("network"));
    expect(location(await call(`?code=${CODE}`))).toBe("/login?reason=link_invalid&next=%2Flink-account");
  });
});

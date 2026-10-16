import { beforeEach, describe, expect, it, vi } from "vitest";

// "Forgot password?" server action, with Supabase and the audit trail stubbed:
// the browser always gets the same answer (no account enumeration, rate limits
// not revealed), only the existing Supabase recovery call is made, and the audit
// event carries the requested address and a reason code — never a token.

const supa = vi.hoisted(() => ({ reset: vi.fn(), signIn: vi.fn() }));
vi.mock("@/server/supabase", () => ({
  createSupabaseServerClient: async () => ({ auth: { resetPasswordForEmail: supa.reset, signInWithPassword: supa.signIn } }),
}));
const audit = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock("@/server/audit", () => ({ recordAuditEvent: async (e: unknown) => void audit.events.push(e) }));
const cfg = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/auth/config", () => ({ isSupabaseAuthEnabled: () => cfg.enabled }));

const { requestPasswordResetAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  audit.events = [];
  cfg.enabled = true;
});

describe("requestPasswordResetAction", () => {
  it("answers identically for existing accounts, unknown accounts and Supabase rate limits", async () => {
    supa.reset.mockResolvedValueOnce({ error: null }); // account exists: email sent
    const a = await requestPasswordResetAction({ email: " Someone@Example.com " });
    supa.reset.mockResolvedValueOnce({ error: null }); // unknown: Supabase also says nothing
    const b = await requestPasswordResetAction({ email: "nobody@example.com" });
    supa.reset.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit" } });
    const c = await requestPasswordResetAction({ email: "someone@example.com" });
    supa.reset.mockResolvedValueOnce({ error: { status: 400, code: "unexpected" } });
    const d = await requestPasswordResetAction({ email: "someone@example.com" });
    expect([a, b, c, d]).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    // Normalised; the only option is the recovery link's destination (this app's callback, then set-password). No credentials.
    expect(supa.reset).toHaveBeenNthCalledWith(1, "someone@example.com", { redirectTo: "http://localhost:3000/auth/callback?next=%2Fauth%2Fset-password" });
  });

  it("only a service/network failure is reported, and invalid input never reaches Supabase", async () => {
    supa.reset.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await requestPasswordResetAction({ email: "someone@example.com" })).toEqual({ ok: false, error: "unavailable" });
    expect(await requestPasswordResetAction({ email: "not-an-email" })).toEqual({ ok: false, error: "invalid_input" });
    expect(supa.reset).toHaveBeenCalledTimes(1);
    cfg.enabled = false;
    expect(await requestPasswordResetAction({ email: "someone@example.com" })).toEqual({ ok: false, error: "not_configured" });
  });

  it("audits each request with a reason code and no token or password; never touches sign-in", async () => {
    supa.reset.mockResolvedValueOnce({ error: { status: 429 } });
    await requestPasswordResetAction({ email: "someone@example.com" });
    expect(audit.events).toEqual([{ action: "auth.password_reset_requested", outcome: "FAILURE", actorLabel: "someone@example.com", reason: "rate_limited" }]);
    const { actorLabel, reason, ...rest } = audit.events[0] as Record<string, unknown>;
    expect(`${actorLabel} ${reason} ${JSON.stringify(rest.metadata ?? null)}`).not.toMatch(/token|secret|code=|access_token/i); // the action name itself contains "password"
    expect(supa.signIn).not.toHaveBeenCalled();
  });
});

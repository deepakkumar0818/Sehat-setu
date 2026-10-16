import { beforeEach, describe, expect, it, vi } from "vitest";

// P6.4 self-registration Server Action, with Supabase and the audit trail
// stubbed: the browser gets the same answer whether or not the address already
// has a login (no account enumeration); only signUp is called (no admin API);
// the password is never audited.

const supa = vi.hoisted(() => ({ signUp: vi.fn(), verifyOtp: vi.fn(), resend: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: { signUp: supa.signUp, verifyOtp: supa.verifyOtp, resend: supa.resend } }) }));
const audit = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock("@/server/audit", () => ({ recordAuditEvent: async (e: Record<string, unknown>) => void audit.events.push(e) }));
const cfg = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/auth/config", () => ({ isSupabaseAuthEnabled: () => cfg.enabled }));

const { resendEmailOtpAction, signUpAction, verifyEmailOtpAction } = await import("./actions");
const PASSWORD = "zz-correct-horse-battery";
const DETAILS = { name: "Asha Verma", phone: "+91 98765 43210", dateOfBirth: "1990-04-12", gender: "female" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  audit.events = [];
  cfg.enabled = true;
});

describe("signUpAction", () => {
  it("answers identically for a new address and one that already has a login", async () => {
    supa.signUp.mockResolvedValueOnce({ data: { user: { id: "new" } }, error: null });
    const a = await signUpAction({ ...DETAILS, email: " New@Example.com ", password: PASSWORD });
    supa.signUp.mockResolvedValueOnce({ data: { user: { id: "obfuscated", identities: [] } }, error: null }); // Supabase's answer for an existing address
    const b = await signUpAction({ ...DETAILS, email: "existing@example.com", password: PASSWORD });
    supa.signUp.mockResolvedValueOnce({ data: { user: null }, error: { code: "user_already_exists", status: 422 } });
    const c = await signUpAction({ ...DETAILS, email: "existing@example.com", password: PASSWORD });
    expect([a, b, c]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // Normalised; the details go to user_metadata, and the confirmation link returns to this app's callback, then /link-account.
    expect(supa.signUp).toHaveBeenNthCalledWith(1, {
      email: "new@example.com",
      password: PASSWORD,
      options: { data: DETAILS, emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Flink-account" },
    });
  });

  it("validates before calling Supabase (details, 12–72 character password, valid email, no extra fields)", async () => {
    for (const input of [{ email: "a@b.co", password: PASSWORD }, { ...DETAILS, name: "A", email: "a@b.co", password: PASSWORD }, { ...DETAILS, dateOfBirth: "2999-01-01", email: "a@b.co", password: PASSWORD }, { ...DETAILS, phone: "call me", email: "a@b.co", password: PASSWORD }, { ...DETAILS, email: "x", password: PASSWORD }, { ...DETAILS, email: "a@b.co", password: "short" }, { ...DETAILS, email: "a@b.co", password: "x".repeat(73) }, { ...DETAILS, email: "a@b.co", password: PASSWORD, role: "ADMINISTRATOR" }, null]) {
      expect(await signUpAction(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(supa.signUp).not.toHaveBeenCalled();
    cfg.enabled = false;
    expect(await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD })).toEqual({ ok: false, error: "not_configured" });
  });

  it("reports weak passwords, rate limits, closed sign-up and outages (none of which reveal an account)", async () => {
    supa.signUp.mockResolvedValueOnce({ error: { code: "weak_password", status: 422 } });
    expect(await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD })).toEqual({ ok: false, error: "weak_password" });
    supa.signUp.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", status: 429 } });
    expect(await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD })).toEqual({ ok: false, error: "rate_limited" });
    supa.signUp.mockResolvedValueOnce({ error: { code: "signup_disabled", status: 422 } });
    expect(await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD })).toEqual({ ok: false, error: "closed" });
    supa.signUp.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD })).toEqual({ ok: false, error: "unavailable" });
  });

  it("audits each request with a reason code and never the password", async () => {
    supa.signUp.mockResolvedValueOnce({ error: { code: "user_already_exists", status: 422 } });
    await signUpAction({ ...DETAILS, email: "a@b.co", password: PASSWORD });
    expect(audit.events).toEqual([{ action: "auth.sign_up_requested", outcome: "SUCCESS", actorLabel: "a@b.co", reason: "already_registered" }]);
    expect(JSON.stringify(audit.events)).not.toContain(PASSWORD);
  });
});

describe("confirmation link destination", () => {
  it("development: back to localhost, never a Vercel URL; production without a configured URL: Supabase's Site URL (no redirect sent)", async () => {
    const env = { ...process.env };
    try {
      process.env.NEXT_PUBLIC_APP_URL = "https://sehat-setu-old.vercel.app";
      process.env.VERCEL_URL = "sehat-setu-old.vercel.app";
      supa.signUp.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
      await signUpAction({ ...DETAILS, email: "zz@example.com", password: PASSWORD });
      expect(supa.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("http://localhost:3000/auth/callback?next=%2Flink-account");
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.NEXT_PUBLIC_APP_URL;
      await signUpAction({ ...DETAILS, email: "zz@example.com", password: PASSWORD });
      expect(supa.signUp.mock.calls[1][0]).toEqual({ email: "zz@example.com", password: PASSWORD, options: { data: DETAILS } });
    } finally {
      for (const k of ["NODE_ENV", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"]) (process.env as Record<string, string | undefined>)[k] = env[k];
    }
  });
});

describe("verifyEmailOtpAction", () => {
  it("verifies the emailed code for the normalised address and audits the outcome, never the code", async () => {
    supa.verifyOtp.mockResolvedValueOnce({ data: {}, error: null });
    expect(await verifyEmailOtpAction({ email: " New@Example.com ", token: "123456" })).toEqual({ ok: true });
    expect(supa.verifyOtp).toHaveBeenCalledWith({ email: "new@example.com", token: "123456", type: "email" });
    expect(audit.events).toEqual([{ action: "auth.sign_up_otp_verified", outcome: "SUCCESS", actorLabel: "new@example.com", reason: undefined }]);
    expect(JSON.stringify(audit.events)).not.toContain("123456");
  });

  it("gives one answer for a wrong or expired code, and validates before calling Supabase", async () => {
    supa.verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired", status: 403 } });
    expect(await verifyEmailOtpAction({ email: "a@b.co", token: "123456" })).toEqual({ ok: false, error: "invalid_code" });
    supa.verifyOtp.mockResolvedValueOnce({ error: { code: "over_request_rate_limit", status: 429 } });
    expect(await verifyEmailOtpAction({ email: "a@b.co", token: "123456" })).toEqual({ ok: false, error: "rate_limited" });
    supa.verifyOtp.mockClear();
    for (const input of [{ email: "a@b.co", token: "12ab" }, { email: "x", token: "123456" }, { email: "a@b.co", token: "123456", type: "recovery" }, null]) {
      expect(await verifyEmailOtpAction(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(supa.verifyOtp).not.toHaveBeenCalled();
  });

  it("resends a sign-up code, reporting only rate limits", async () => {
    supa.resend.mockResolvedValueOnce({ error: null });
    expect(await resendEmailOtpAction({ email: "A@b.co" })).toEqual({ ok: true });
    expect(supa.resend).toHaveBeenCalledWith({ type: "signup", email: "a@b.co" });
    supa.resend.mockResolvedValueOnce({ error: { status: 429 } });
    expect(await resendEmailOtpAction({ email: "a@b.co" })).toEqual({ ok: false, error: "rate_limited" });
  });
});

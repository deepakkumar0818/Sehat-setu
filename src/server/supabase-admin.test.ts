import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createSupabaseMailer, mailerConfigProblem, readSecretKey, sendInvitationEmail } = await import("./supabase-admin");

const PUBLIC = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pub123" };

type Err = { code?: string; status?: number; name?: string } | null;
const mailer = (invite: Err, link: Err = null) => {
  const m = { invite: vi.fn(async () => ({ error: invite })), signInLink: vi.fn(async () => ({ error: link })) };
  return m;
};

describe("Supabase secret key handling", () => {
  it("accepts a secret key and refuses missing, placeholder or publishable keys", () => {
    expect(readSecretKey({ SUPABASE_SECRET_KEY: "sb_secret_abc123" })).toBe("sb_secret_abc123");
    expect(readSecretKey({})).toBeNull();
    expect(readSecretKey({ SUPABASE_SECRET_KEY: "  " })).toBeNull();
    expect(readSecretKey({ SUPABASE_SECRET_KEY: "[YOUR-SECRET-KEY]" })).toBeNull();
    expect(readSecretKey({ SUPABASE_SECRET_KEY: "sb_publishable_xyz" })).toBeNull();
    expect(readSecretKey({ SUPABASE_SECRET_KEY: "same", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "same" })).toBeNull();
  });
});

describe("email configuration diagnostics (names the setting, never the value)", () => {
  it("says exactly which setting is missing or wrong", () => {
    expect(mailerConfigProblem({ ...PUBLIC, SUPABASE_SECRET_KEY: "sb_secret_ok123" })).toBeNull();
    expect(mailerConfigProblem(PUBLIC)).toMatch(/^SUPABASE_SECRET_KEY is not set in the server environment \(\.env\.local\)/);
    expect(mailerConfigProblem({ ...PUBLIC, SUPABASE_SECRET_KEY: "   " })).toMatch(/SUPABASE_SECRET_KEY is not set/);
    expect(mailerConfigProblem({ ...PUBLIC, SUPABASE_SECRET_KEY: "[YOUR-SECRET-KEY]" })).toMatch(/placeholder/);
    expect(mailerConfigProblem({ ...PUBLIC, SUPABASE_SECRET_KEY: "sb_publishable_pub123" })).toMatch(/publishable key/);
    expect(mailerConfigProblem({ SUPABASE_SECRET_KEY: "sb_secret_ok123" })).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("never includes the key itself", () => {
    for (const key of ["sb_publishable_pub123", "<sb_secret_should_not_leak>"]) {
      expect(mailerConfigProblem({ ...PUBLIC, SUPABASE_SECRET_KEY: key })).not.toContain(key);
    }
  });

  it("without a secret key there is no mailer, and the server log names the variable once (no value)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLIC.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(createSupabaseMailer()).toBeNull();
      expect(createSupabaseMailer()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("SUPABASE_SECRET_KEY is not set");
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("with a secret key a mailer is built (no network call is made here)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLIC.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_fake_for_test");
    try {
      const m = createSupabaseMailer();
      expect(m).not.toBeNull();
      expect(typeof m?.invite).toBe("function");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("invitation email delivery", () => {
  it("not configured → a coded failure, nothing sent", async () => {
    expect(await sendInvitationEmail("a@b.co", null)).toEqual({ ok: false, error: "not_configured" });
  });

  it("new address → invite email", async () => {
    const m = mailer(null);
    expect(await sendInvitationEmail("a@b.co", m)).toEqual({ ok: true });
    expect(m.invite).toHaveBeenCalledWith("a@b.co");
    expect(m.signInLink).not.toHaveBeenCalled();
  });

  it("existing account → generic sign-in link, reported exactly like a new invite (no enumeration)", async () => {
    const existing = mailer({ code: "email_exists", status: 422 });
    const fresh = mailer(null);
    const a = await sendInvitationEmail("a@b.co", existing);
    const b = await sendInvitationEmail("a@b.co", fresh);
    expect(a).toEqual(b);
    expect(existing.signInLink).toHaveBeenCalledWith("a@b.co");
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "user_already_exists", status: 422 }))).toEqual({ ok: true });
  });

  it("maps provider failures to codes (no provider text is kept)", async () => {
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "over_email_send_rate_limit", status: 429 }))).toEqual({ ok: false, error: "rate_limited" });
    expect(await sendInvitationEmail("a@b.co", mailer({ name: "AuthRetryableFetchError", status: 0 }))).toEqual({ ok: false, error: "unavailable" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "email_address_not_authorized", status: 400 }))).toEqual({ ok: false, error: "not_authorized" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "validation_failed", status: 400 }))).toEqual({ ok: false, error: "provider_error" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "email_exists", status: 422 }, { status: 503 }))).toEqual({ ok: false, error: "unavailable" });
  });

  it("tells a rejected key, a disabled provider and an SMTP/template failure apart from a network problem", async () => {
    expect(await sendInvitationEmail("a@b.co", mailer({ status: 401 }))).toEqual({ ok: false, error: "key_rejected" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "not_admin", status: 403 }))).toEqual({ ok: false, error: "key_rejected" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "email_provider_disabled", status: 400 }))).toEqual({ ok: false, error: "email_disabled" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "unexpected_failure", status: 500 }))).toEqual({ ok: false, error: "send_failed" });
    expect(await sendInvitationEmail("a@b.co", mailer({ status: 504 }))).toEqual({ ok: false, error: "unavailable" });
    expect(await sendInvitationEmail("a@b.co", mailer({ code: "request_timeout", status: 504 }))).toEqual({ ok: false, error: "unavailable" });
  });

  it("never throws, even if the client does", async () => {
    const m = { invite: vi.fn(async () => { throw new Error("socket hang up"); }), signInLink: vi.fn() };
    expect(await sendInvitationEmail("a@b.co", m)).toEqual({ ok: false, error: "unavailable" });
  });
});

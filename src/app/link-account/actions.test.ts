import { beforeEach, describe, expect, it, vi } from "vitest";

// /link-account Server Actions, with the session, Supabase, cookies and data
// calls replaced (no database). Existing records link ONLY with the clinic's
// single-use code; a new patient's record is created from their details; an
// unconfirmed login gets neither.

const m = vi.hoisted(() => ({
  authUser: null as null | { id: string; email: string | null; emailConfirmed: boolean; metadata?: Record<string, unknown> },
  cookieSet: vi.fn(),
  updateUser: vi.fn(async () => ({ error: null })),
  redeem: vi.fn(),
  register: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({
  requireAuthUser: async () => {
    const { AuthError } = await import("@/server/auth/errors");
    if (!m.authUser) throw new AuthError("UNAUTHENTICATED");
    return m.authUser;
  },
  ACTIVE_CLINIC_COOKIE: "sehat_active_clinic",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: m.cookieSet }) }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: { updateUser: m.updateUser } }) }));
vi.mock("@/server/data/patient-link", () => ({ redeemPortalLinkCode: m.redeem, registerSelfPatient: m.register }));
vi.mock("@/server/monitoring", () => ({ reportEvent: vi.fn(), reportServerError: vi.fn() }));

const { completeRegistrationAction, redeemLinkCodeAction } = await import("./actions");

const CONFIRMED = { id: "auth-1", email: "asha@example.com", emailConfirmed: true };
const DETAILS = { name: "Asha Verma", phone: "+91 98765 43210", dateOfBirth: "1990-04-12", gender: "female" } as const;
const CODE = "ABCD-EFGH-JKMN-PQRS";

beforeEach(() => {
  vi.clearAllMocks();
  m.authUser = { ...CONFIRMED };
});

describe("redeemLinkCodeAction (existing record: clinic-issued single-use code)", () => {
  it("links with a valid code and opens that clinic; only the code is sent", async () => {
    m.redeem.mockResolvedValueOnce({ result: "LINKED", clinicId: "clinic-aarogya" });
    expect(await redeemLinkCodeAction({ code: CODE })).toEqual({ ok: true });
    expect(m.redeem).toHaveBeenCalledWith(m.authUser, { code: CODE });
    expect(m.cookieSet).toHaveBeenCalledWith("sehat_active_clinic", "clinic-aarogya", expect.objectContaining({ httpOnly: true }));
  });

  it("refuses unusable codes, rate limits and ineligible accounts without linking", async () => {
    m.redeem.mockResolvedValueOnce({ result: "INVALID", clinicId: null });
    expect(await redeemLinkCodeAction({ code: CODE })).toMatchObject({ ok: false, error: "invalid" });
    m.redeem.mockResolvedValueOnce({ result: "RATE_LIMITED", clinicId: null });
    expect(await redeemLinkCodeAction({ code: CODE })).toMatchObject({ ok: false, error: "rate_limited" });
    m.redeem.mockResolvedValueOnce({ result: "NOT_ELIGIBLE", clinicId: null });
    expect(await redeemLinkCodeAction({ code: CODE })).toMatchObject({ ok: false, error: "not_eligible" });
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it("an unconfirmed or signed-out login can't redeem, and a browser can't add a patient or clinic id", async () => {
    m.authUser = { ...CONFIRMED, emailConfirmed: false };
    expect(await redeemLinkCodeAction({ code: CODE })).toMatchObject({ ok: false, error: "email_not_verified" });
    m.authUser = null;
    expect(await redeemLinkCodeAction({ code: CODE })).toMatchObject({ ok: false, error: "signed_out" });
    m.authUser = { ...CONFIRMED };
    expect(await redeemLinkCodeAction({ code: CODE, patientId: "p-1" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(m.redeem).not.toHaveBeenCalled();
  });
});

describe("completeRegistrationAction (new patient: no record carries the email)", () => {
  it("creates and links the new patient's record from the details, saving them on the login", async () => {
    m.register.mockResolvedValueOnce({ result: "LINKED", clinicId: "clinic-aarogya" });
    expect(await completeRegistrationAction(DETAILS)).toEqual({ ok: true });
    expect(m.updateUser).toHaveBeenCalledWith({ data: DETAILS });
    expect(m.register).toHaveBeenCalledWith(m.authUser, DETAILS);
    expect(m.cookieSet).toHaveBeenCalledOnce();
  });

  it("missing patient record vs existing one: an existing record with this email needs the clinic's code", async () => {
    m.register.mockResolvedValueOnce({ result: "NEEDS_CODE", clinicId: null });
    expect(await completeRegistrationAction(DETAILS)).toMatchObject({ ok: false, error: "needs_code", message: expect.stringMatching(/linking code/) });
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it("an unconfirmed login gets no record, and details are validated first (no clinic from the browser)", async () => {
    m.authUser = { ...CONFIRMED, emailConfirmed: false };
    expect(await completeRegistrationAction(DETAILS)).toMatchObject({ ok: false, error: "email_not_verified" });
    m.authUser = { ...CONFIRMED };
    for (const input of [{ ...DETAILS, name: "A" }, { ...DETAILS, dateOfBirth: "2999-01-01" }, { ...DETAILS, clinicId: "clinic-nirmaya" }, null]) {
      expect(await completeRegistrationAction(input)).toMatchObject({ ok: false, error: "invalid_input" });
    }
    expect(m.register).not.toHaveBeenCalled();
    expect(m.updateUser).not.toHaveBeenCalled();
  });
});

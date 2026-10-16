import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// /link-account, server-rendered with the session and data calls replaced: what
// each signed-in state sees. Existing records are offered ONLY the clinic code;
// a new patient with saved details gets a record and goes to the portal; an
// unconfirmed login is offered nothing.

const m = vi.hoisted(() => ({
  authUser: null as null | { id: string; email: string | null; emailConfirmed: boolean; metadata?: Record<string, unknown> },
  identity: null as null | Record<string, unknown>,
  register: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/config", () => ({ isSupabaseAuthEnabled: () => true }));
vi.mock("@/server/auth/session", () => ({
  requireAuthUser: async () => {
    const { AuthError } = await import("@/server/auth/errors");
    if (!m.authUser) throw new AuthError("UNAUTHENTICATED");
    return m.authUser;
  },
  requireIdentity: async () => {
    if (!m.identity) throw new Error("not provisioned");
    return m.identity;
  },
  authErrorDestination: () => "/login?reason=signin",
  ACTIVE_CLINIC_COOKIE: "sehat_active_clinic",
}));
vi.mock("@/server/auth/authorize", () => ({ homeFor: (i: { home: string }) => i.home }));
vi.mock("@/server/data/patient-link", () => ({ registerSelfPatient: m.register, redeemPortalLinkCode: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: {} }) }));
vi.mock("@/server/monitoring", () => ({ reportEvent: vi.fn(), reportServerError: vi.fn() }));

const { default: LinkAccountPage } = await import("./page");

const DETAILS = { name: "Asha Verma", phone: "+91 98765 43210", dateOfBirth: "1990-04-12", gender: "female" };
const CONFIRMED = { id: "auth-1", email: "asha@example.com", emailConfirmed: true, metadata: DETAILS };

async function visit(): Promise<{ redirect?: string; html?: string }> {
  try {
    return { html: renderToStaticMarkup(await LinkAccountPage()) };
  } catch (err) {
    const to = (err as { to?: string }).to;
    if (to) return { redirect: to };
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  m.authUser = { ...CONFIRMED };
  m.identity = null;
});

describe("/link-account", () => {
  it("signed out: back to sign-in", async () => {
    m.authUser = null;
    expect(await visit()).toEqual({ redirect: "/login?reason=signin" });
  });

  it("unverified signup: no record is created or linked, and no linking form is offered", async () => {
    m.authUser = { ...CONFIRMED, emailConfirmed: false };
    const { html } = await visit();
    expect(html).toMatch(/Confirm your email address first/);
    expect(html).not.toMatch(/Linking code|New patient — your details/);
    expect(m.register).not.toHaveBeenCalled();
  });

  it("verified new patient (no record yet): their record is created from the saved details, then the portal", async () => {
    m.register.mockResolvedValueOnce({ result: "LINKED", clinicId: "clinic-aarogya" });
    expect(await visit()).toEqual({ redirect: "/portal" });
    expect(m.register).toHaveBeenCalledWith(m.authUser, DETAILS);
  });

  it("verified, but a record with this email exists: nothing is linked by email — only the clinic code is offered", async () => {
    m.register.mockResolvedValueOnce({ result: "NEEDS_CODE", clinicId: null });
    const { html } = await visit();
    expect(html).toMatch(/already has a patient record with this email/);
    expect(html).toMatch(/Linking code/);
    expect(html).not.toMatch(/New patient — your details/);
  });

  it("verified login without saved details: offers the clinic code or the new-patient details form; creates nothing yet", async () => {
    m.authUser = { ...CONFIRMED, metadata: {} };
    const { html } = await visit();
    expect(html).toMatch(/Linking code/);
    expect(html).toMatch(/New patient — your details/);
    expect(m.register).not.toHaveBeenCalled();
  });

  it("already linked or staff: straight to the right home", async () => {
    m.identity = { patientLinks: [{ patientId: "p-1" }], home: "portal" };
    expect(await visit()).toEqual({ redirect: "/portal" });
    m.identity = { patientLinks: [], home: "staff" };
    expect(await visit()).toEqual({ redirect: "/dashboard" });
    expect(m.register).not.toHaveBeenCalled();
  });

  it("a database failure shows a retry, not a false success", async () => {
    m.register.mockRejectedValueOnce(new Error("connection reset"));
    const { html } = await visit();
    expect(html).toMatch(/Couldn&#x27;t set up your account right now/);
    expect(html).toMatch(/Try again/);
  });
});

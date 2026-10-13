import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/v1/me/invitations/[id]/accept, with the session, cookies and data
// call replaced (no database): ownership comes from the verified session only,
// and the clinic just joined becomes the active one for the next page load.

const m = vi.hoisted(() => ({
  identity: null as null | Record<string, unknown>,
  cookieSet: vi.fn(),
  accept: vi.fn(async () => ({ clinicId: "clinic-aarogya" })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({
  requireIdentity: async () => {
    const { AuthError } = await import("@/server/auth/errors");
    if (!m.identity) throw new AuthError("UNAUTHENTICATED");
    return m.identity;
  },
  requireStaff: async () => { throw new Error("not used"); },
  ACTIVE_CLINIC_COOKIE: "sehat_active_clinic",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: m.cookieSet }) }));
vi.mock("@/server/data/invitations", () => ({ acceptInvitation: m.accept }));

const { POST } = await import("./route");

const ID = "05d8457c-0000-4000-8000-000000000001";
const post = (body?: unknown) =>
  POST(new NextRequest(`http://localhost/api/v1/me/invitations/${ID}/accept`, { method: "POST", body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id: ID }) });

const rahul = { userId: "u-rahul", authUserId: "auth-rahul", email: "rahul@example.com", name: "Rahul", status: "ACTIVE", memberships: [], verifiedEmail: "rahul@example.com" };

beforeEach(() => {
  m.identity = { ...rahul };
  m.cookieSet.mockClear();
  m.accept.mockClear();
});

describe("accepting an invitation (route)", () => {
  it("accepts for the verified session (a browser-supplied email or user id is ignored) and opens the joined clinic", async () => {
    const res = await post({ email: "attacker@example.com", userId: "u-someone-else" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clinicId: "clinic-aarogya" });
    expect(m.accept).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-rahul", verifiedEmail: "rahul@example.com" }), ID);
    expect(m.cookieSet).toHaveBeenCalledWith("sehat_active_clinic", "clinic-aarogya", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("refuses an unconfirmed email before touching the database", async () => {
    m.identity = { ...rahul, verifiedEmail: null };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(m.accept).not.toHaveBeenCalled();
    expect(m.cookieSet).not.toHaveBeenCalled();
  });

  it("refuses when signed out, and a disabled account", async () => {
    m.identity = null;
    expect((await post()).status).toBe(401);
    m.identity = { ...rahul, status: "DISABLED" };
    expect((await post()).status).toBe(403);
    expect(m.accept).not.toHaveBeenCalled();
  });

  it("a refusal from the database (e.g. revoked) sets no cookie", async () => {
    const { DataError } = await import("@/server/api/errors");
    m.accept.mockRejectedValueOnce(new DataError("REVOKED", "This invitation was withdrawn. Ask your clinic administrator if this is a mistake."));
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("REVOKED");
    expect(m.cookieSet).not.toHaveBeenCalled();
  });
});

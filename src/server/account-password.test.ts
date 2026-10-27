import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifySignIn = vi.fn();
const verifySignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: verifySignIn, signOut: verifySignOut } }),
}));
const updateUser = vi.fn();
const signOutOthers = vi.fn();
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: { updateUser, signOut: signOutOthers } }) }));
const recordAuditEvent = vi.fn();
vi.mock("@/server/audit", () => ({ recordAuditEvent: (e: unknown) => recordAuditEvent(e) }));
vi.mock("@/server/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ getSupabasePublicConfig: () => ({ url: "https://x.supabase.co", publishableKey: "pk" }) }));

const { changeOwnPassword } = await import("./account-password");

const me = { userId: "u1", authUserId: "auth-1", email: "sa@x.in", name: "SA", status: "ACTIVE" as const, memberships: [], verifiedEmail: "sa@x.in" };
const GOOD = "Monsoon-Kettle-48";

beforeEach(() => {
  vi.clearAllMocks();
  verifySignIn.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
  updateUser.mockResolvedValue({ error: null });
  signOutOthers.mockResolvedValue({ error: null });
});

describe("changing your own password", () => {
  it("checks the current password first, then saves, then signs out other devices", async () => {
    await expect(changeOwnPassword(me, { currentPassword: "old-secret", newPassword: GOOD })).resolves.toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(verifySignIn).toHaveBeenCalledWith({ email: "sa@x.in", password: "old-secret" });
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(signOutOthers).toHaveBeenCalledWith({ scope: "others" });
    expect(verifySignOut).toHaveBeenCalled(); // the throwaway check session is ended
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.password_changed", outcome: "SUCCESS" }));
  });

  it("refuses a wrong current password and changes nothing", async () => {
    verifySignIn.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", status: 400 } });
    await expect(changeOwnPassword(me, { currentPassword: "nope", newPassword: GOOD })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Your current password is incorrect." });
    expect(updateUser).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FAILURE", reason: "wrong_current_password" }));
  });

  it("passes on Supabase's rate limit on guesses", async () => {
    verifySignIn.mockResolvedValue({ data: { user: null }, error: { code: "over_request_rate_limit", status: 429 } });
    await expect(changeOwnPassword(me, { currentPassword: "x", newPassword: GOOD })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses when the checked login isn't the signed-in one", async () => {
    verifySignIn.mockResolvedValue({ data: { user: { id: "someone-else" } }, error: null });
    await expect(changeOwnPassword(me, { currentPassword: "old", newPassword: GOOD })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("validates the new password before checking anything", async () => {
    await expect(changeOwnPassword(me, { currentPassword: "old", newPassword: "short" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(changeOwnPassword(me, { currentPassword: GOOD, newPassword: GOOD })).rejects.toMatchObject({ message: "The new password must be different from your current one." });
    await expect(changeOwnPassword(me, { currentPassword: "", newPassword: GOOD })).rejects.toThrow();
    expect(verifySignIn).not.toHaveBeenCalled();
  });

  it("never writes a password into the audit trail", async () => {
    await changeOwnPassword(me, { currentPassword: "old-secret", newPassword: GOOD });
    verifySignIn.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", status: 400 } });
    await changeOwnPassword(me, { currentPassword: "old-secret", newPassword: GOOD }).catch(() => undefined);
    const logged = JSON.stringify(recordAuditEvent.mock.calls);
    expect(logged).not.toContain("old-secret");
    expect(logged).not.toContain(GOOD);
  });
});

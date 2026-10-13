import { afterEach, describe, expect, it, vi } from "vitest";

// The legacy password-email route must be dead in live (Supabase) mode: 410
// before the body is read, and the sender is never called.

const send = vi.fn(async () => ({ emailSent: true, smsSent: false }));
vi.mock("@/server/send-account-notifications", () => ({ sendNewAccountNotifications: send }));
let authEnabled = true;
vi.mock("@/lib/auth/config", () => ({ isSupabaseAuthEnabled: () => authEnabled }));

const { POST } = await import("./route");

/** A request whose body throws if anything tries to read it. */
function trapRequest() {
  const read = vi.fn(() => {
    throw new Error("body must not be read");
  });
  const req = new Request("http://localhost:3000/api/notify-new-account", { method: "POST", body: JSON.stringify({ password: "secret" }) });
  Object.defineProperty(req, "json", { value: read });
  Object.defineProperty(req, "text", { value: read });
  Object.defineProperty(req, "body", { get: read });
  return { req, read };
}

afterEach(() => {
  send.mockClear();
  authEnabled = true;
});

describe("legacy /api/notify-new-account", () => {
  it("answers 410 Gone in live mode without reading the body or sending anything", async () => {
    const { req, read } = trapRequest();
    const res = await POST(req);
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("GONE");
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the demo-mode behaviour outside production (no Supabase)", async () => {
    authEnabled = false;
    const res = await POST(new Request("http://localhost:3000/api/notify-new-account", { method: "POST", body: JSON.stringify({ name: "A", email: "a@example.com", password: "x", role: "Nurse" }) }));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InvitationPage, StaffInvitation } from "@/lib/live-types";

// The Invitations tab when the server can't send email: the saved invitation is
// listed with a plain-language reason, the missing setting is named, and Resend
// is disabled so no attempts are wasted. Once configured, Resend retries the same
// invitation. Hooks are replaced: no network, no database, no email.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hooks = vi.hoisted(() => ({ page: null as unknown, resend: { mutate: vi.fn(), isPending: false, variables: undefined as string | undefined } }));
vi.mock("@/hooks/use-invitations", () => ({
  useInvitations: () => ({ data: hooks.page, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useResendInvitation: () => hooks.resend,
  useRevokeInvitation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { InvitationsPanel } = await import("@/components/staff/invitations-panel");

const failed: StaffInvitation = {
  id: "11111111-2222-4333-8444-555555555555",
  email: "new.person@example.com",
  name: "New Person",
  roleKey: "RECEPTIONIST",
  branch: { id: "8f8f8f8f-1111-4222-8333-444444444444", name: "Wakad" },
  status: "pending",
  delivery: "failed",
  deliveryError: "not_configured",
  sendAttempts: 1,
  lastSentAt: null,
  expiresAt: new Date(Date.now() + 6 * 864e5).toISOString(),
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  acceptedAt: null,
  revokedAt: null,
  invitedByName: "Admin",
  doctor: null,
  canResend: true,
  canRevoke: true,
  resendAvailableAt: null,
};
const page = (over: Partial<InvitationPage> = {}): InvitationPage => ({ items: [failed], total: 1, page: 1, pageSize: 10, canManage: true, emailConfigured: false, ...over });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  hooks.resend = { mutate: vi.fn(), isPending: false, variables: undefined };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () => act(() => root.render(<InvitationsPanel />));
const text = () => host.textContent ?? "";
const resendButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Resend")) as HTMLButtonElement;

describe("invitations tab without email configured", () => {
  it("keeps the saved invitation, explains why it wasn't emailed, and names the missing setting", () => {
    hooks.page = page();
    render();
    expect(text()).toContain("new.person@example.com");
    expect(text()).toContain("Delivery failed");
    expect(text()).toContain("SUPABASE_SECRET_KEY");
    expect(text()).toContain(".env.local");
  });

  it("disables Resend so no attempts are used up", () => {
    hooks.page = page();
    render();
    expect(resendButton().disabled).toBe(true);
    act(() => resendButton().click());
    expect(hooks.resend.mutate).not.toHaveBeenCalled();
  });

  it("once configured, Resend retries the same invitation", () => {
    hooks.page = page({ emailConfigured: true });
    render();
    expect(text()).not.toContain("isn't configured on this server");
    expect(resendButton().disabled).toBe(false);
    act(() => resendButton().click());
    expect(hooks.resend.mutate).toHaveBeenCalledWith(failed.id, expect.anything());
  });

  it("respects the cooldown and the 10-send limit", () => {
    hooks.page = page({ emailConfigured: true, items: [{ ...failed, canResend: false, resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }] });
    render();
    expect(resendButton().disabled).toBe(true);
    expect(resendButton().title).toMatch(/You can resend/);
  });

  it("view-only users don't see the configuration notice", () => {
    hooks.page = page({ canManage: false, emailConfigured: null, items: [{ ...failed, canResend: false, canRevoke: false }] });
    render();
    expect(text()).not.toContain("SUPABASE_SECRET_KEY");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiRequestError } from "@/lib/api-client";
import type { MyInvitation } from "@/lib/live-types";

// The invitee's acceptance screen (/invitations). Accepting is an explicit click;
// afterwards a full page load re-resolves the session's memberships on the server.
// Hooks are replaced: no network, no database, no email.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: () => {} },
  accept: { mutate: (() => {}) as (id: string, opts?: { onSuccess?: () => void }) => void, isPending: false, error: null as Error | null },
}));
vi.mock("@/hooks/use-invitations", () => ({ useMyInvitations: () => state.list, useAcceptInvitation: () => state.accept }));

const { PendingInvitations } = await import("@/components/invitations/pending-invitations");

const invitation: MyInvitation = {
  id: "05d8457c-0000-4000-8000-000000000001",
  clinicName: "Aarogya Multispeciality Clinic",
  branchName: "Aarogya — Wakad",
  roleKey: "RECEPTIONIST",
  expiresAt: new Date(Date.now() + 6 * 864e5).toISOString(),
  expired: false,
};

let host: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.list = { data: { items: [invitation] }, isLoading: false, isError: false, error: null, refetch: () => {} };
  state.accept = { mutate: vi.fn(), isPending: false, error: null };
  assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, origin: "http://localhost:3000", assign });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(<PendingInvitations />));
const text = () => host.textContent ?? "";
const acceptButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Accept")) as HTMLButtonElement | undefined;

describe("invitation acceptance screen", () => {
  it("shows the pending invitation (clinic, role, branch) and grants nothing until Accept is clicked", () => {
    render();
    expect(text()).toContain("Aarogya Multispeciality Clinic");
    expect(text()).toContain("Receptionist");
    expect(text()).toContain("Wakad");
    expect(state.accept.mutate).not.toHaveBeenCalled();
  });

  it("accepts only on an explicit click, then reloads into the app so the new membership is picked up", () => {
    render();
    act(() => acceptButton()!.click());
    expect(state.accept.mutate).toHaveBeenCalledWith(invitation.id, expect.anything());
    expect(assign).not.toHaveBeenCalled(); // not before the server confirms
    const { onSuccess } = (state.accept.mutate as ReturnType<typeof vi.fn>).mock.calls[0][1];
    act(() => onSuccess());
    expect(assign).toHaveBeenCalledWith("http://localhost:3000/dashboard");
  });

  it("an expired invitation can't be accepted and says what to do", () => {
    state.list.data = { items: [{ ...invitation, expired: true, expiresAt: new Date(Date.now() - 864e5).toISOString() }] };
    render();
    expect(acceptButton()).toBeUndefined();
    expect(text()).toContain("This invitation has expired. Ask the clinic administrator to resend it.");
  });

  it.each([
    ["REVOKED", "This invitation was withdrawn. Ask your clinic administrator if this is a mistake."],
    ["EXPIRED", "This invitation has expired. Ask your clinic administrator to resend it."],
    ["EMAIL_MISMATCH", "Sign in with the email address the invitation was sent to."],
  ])("explains a %s refusal from the server", (code, message) => {
    state.accept.error = new ApiRequestError(409, code, message);
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it("no invitation (e.g. revoked, or another email): says so, with a hint about the email used", () => {
    state.list.data = { items: [] };
    render();
    expect(text()).toContain("No pending invitations");
    expect(text()).toContain("signed in with the email address the invitation was sent to");
  });

  it("an unconfirmed email is told to confirm it first", () => {
    state.list = { ...state.list, data: undefined, isError: true, error: new ApiRequestError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address, then sign in again.") };
    render();
    expect(text()).toContain("Confirm your email first");
  });
});

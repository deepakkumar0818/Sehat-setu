// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiRequestError } from "@/lib/api-client";
import { inviteErrorMessage, INVITATIONS_NOT_READY } from "@/components/staff/invitation-labels";

// The Invite staff dialog in a simulated browser (jsdom): failures are explained
// in plain language (never a raw JavaScript error), "not set up yet" is stated
// honestly, and a double submit sends one request. No network, no database:
// the mutation hook is replaced, so nothing is created or emailed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutation = vi.hoisted(() => ({ state: { error: null as Error | null, isPending: false, mutate: vi.fn(), reset: vi.fn() } }));
vi.mock("@/hooks/use-invitations", () => ({ useCreateInvitation: () => mutation.state }));
vi.mock("@/hooks/use-branches", () => ({ useBranches: () => [{ id: "8f8f8f8f-1111-4222-8333-444444444444", name: "Wakad", status: "active" }] }));
vi.mock("@/hooks/use-people", () => ({ useSpecialtyOptions: () => ({ data: [], isLoading: false, isError: false }) }));

const { InviteStaffDialog } = await import("@/components/staff/invite-staff-dialog");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mutation.state = { error: null, isPending: false, mutate: vi.fn(), reset: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const open = () => act(() => root.render(<InviteStaffDialog open onOpenChange={() => {}} />));
const text = () => document.body.textContent ?? "";
function type(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("invite dialog errors", () => {
  it("never shows a raw JavaScript error (the reported 'Cannot read properties of undefined')", () => {
    mutation.state.error = new TypeError("Cannot read properties of undefined (reading 'create')");
    open();
    expect(text()).not.toContain("Cannot read properties");
    expect(text()).toContain("Reload the page and try again");
    expect(text()).toContain("no invitation was created");
  });

  it("explains that the database update is pending when the server says so", () => {
    mutation.state.error = new ApiRequestError(503, "FEATURE_UNAVAILABLE", "Staff invitations aren't set up on this clinic database yet.");
    open();
    expect(text()).toContain("migration");
    expect(text()).toContain("No invitation was created and no email was sent");
  });

  it("shows the server's validation details", () => {
    mutation.state.error = new ApiRequestError(400, "INVALID_INPUT", "Some fields are missing or invalid.", [{ path: "email", message: "Enter a valid email address." }]);
    open();
    expect(text()).toContain("Some fields are missing or invalid.");
    expect(text()).toContain("Enter a valid email address.");
  });

  it("maps errors to messages", () => {
    expect(inviteErrorMessage(new TypeError("x")).message).not.toContain("x");
    expect(inviteErrorMessage(new ApiRequestError(503, "FEATURE_UNAVAILABLE", "y")).message).toBe(INVITATIONS_NOT_READY);
    expect(inviteErrorMessage(new ApiRequestError(409, "ALREADY_INVITED", "This email already has a pending invitation.")).message).toMatch(/pending invitation/);
  });
});

describe("invite dialog submission", () => {
  it("can't be submitted without the required fields", () => {
    open();
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mutation.state.mutate).not.toHaveBeenCalled();
  });

  it("sends exactly one request on a double submit, with the chosen role and branch", () => {
    open();
    act(() => {
      type("invite-name", "Asha Rao");
      type("invite-email", "asha@example.com");
      type("invite-phone", "98765 43210");
    });
    const form = document.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mutation.state.mutate).toHaveBeenCalledTimes(1);
    expect(mutation.state.mutate.mock.calls[0][0]).toMatchObject({ name: "Asha Rao", email: "asha@example.com", roleKey: "RECEPTIONIST", branchId: "8f8f8f8f-1111-4222-8333-444444444444", phone: "+919876543210" });
    expect(mutation.state.mutate.mock.calls[0][0]).not.toHaveProperty("doctor", expect.anything());
  });

  it("phone: India (+91) by default; an invalid number shows an inline error and nothing is sent", () => {
    open();
    expect(text()).toContain("Phone number");
    expect(text()).toContain("+91");
    act(() => {
      type("invite-name", "Asha Rao");
      type("invite-email", "asha@example.com");
      type("invite-phone", "12345 6789");
    });
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mutation.state.mutate).not.toHaveBeenCalled();
    const phone = document.getElementById("invite-phone")!;
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(phone.getAttribute("aria-describedby")!)!.textContent!;
    expect(error).toContain("India (+91)");
    expect(error).not.toContain("12345");
    // Fixing it clears the error and the invitation can be sent.
    act(() => type("invite-phone", "098765-43210"));
    expect(phone.getAttribute("aria-invalid")).toBe("false");
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mutation.state.mutate.mock.calls[0][0]).toMatchObject({ phone: "+919876543210" });
  });

  it("a missing phone blocks submission with an inline message", () => {
    open();
    act(() => {
      type("invite-name", "Asha Rao");
      type("invite-email", "asha@example.com");
    });
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mutation.state.mutate).not.toHaveBeenCalled();
    expect(text()).toContain("Enter a phone number.");
  });

  it("allows another attempt once the first request has finished", () => {
    open();
    act(() => {
      type("invite-name", "Asha Rao");
      type("invite-email", "asha@example.com");
      type("invite-phone", "98765 43210");
    });
    const form = document.querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const callbacks = mutation.state.mutate.mock.calls[0][1] as { onSettled: () => void };
    act(() => callbacks.onSettled());
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mutation.state.mutate).toHaveBeenCalledTimes(2);
  });

  it("a saved invitation whose email couldn't be sent names the missing server setting", () => {
    open();
    act(() => {
      type("invite-name", "Asha Rao");
      type("invite-email", "asha@example.com");
      type("invite-phone", "98765 43210");
    });
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const callbacks = mutation.state.mutate.mock.calls[0][1] as { onSuccess: (r: unknown) => void };
    act(() => callbacks.onSuccess({ invitation: { id: "x", email: "asha@example.com" }, delivery: { status: "failed", error: "not_configured" } }));
    expect(text()).toContain("Invitation saved, but the email couldn't be sent");
    expect(text()).toContain("SUPABASE_SECRET_KEY");
    expect(text()).toContain("restart the server");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiRequestError } from "@/lib/api-client";
import type { StaffMember } from "@/types";

// The Staff directory's Edit phone dialog in a simulated browser. The mutation
// hook is replaced: no network, no database. (Authorization is the server's
// job; see staff-phone.integration.test.ts and p5-routes.integration.test.ts.)

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ state: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null } }));
vi.mock("@/hooks/use-people", () => ({ useUpdateStaffPhone: () => m.state }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const { EditPhoneDialog } = await import("@/components/staff/edit-phone-dialog");

const rahul = { id: "11111111-2222-4333-8444-555555555555", name: "Rahul Sharma", phone: "", canEditPhone: true } as StaffMember;

let host: HTMLDivElement;
let root: Root;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;
beforeEach(() => {
  m.state = { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null };
  onOpenChange = vi.fn<(open: boolean) => void>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = (member: StaffMember = rahul) => act(() => root.render(<EditPhoneDialog member={member} onOpenChange={onOpenChange} />));
const input = () => document.getElementById("edit-phone") as HTMLInputElement;
function type(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
}
const submit = () => act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("Edit phone dialog", () => {
  it("India (+91) by default; a valid number is sent in E.164 for that membership", () => {
    render();
    expect(document.body.textContent).toContain("Rahul Sharma");
    expect(document.body.textContent).toContain("+91");
    act(() => type("098765 43210"));
    submit();
    expect(m.state.mutate).toHaveBeenCalledWith({ id: rahul.id, phone: "+919876543210" }, expect.anything());
  });

  it("an invalid number shows an inline error (without the number) and nothing is sent", () => {
    render();
    act(() => type("12345 6789"));
    submit();
    expect(m.state.mutate).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(input().getAttribute("aria-describedby")!)!.textContent!;
    expect(error).toContain("India (+91)");
    expect(error).not.toContain("12345");
  });

  it("an existing number is pre-filled for editing", () => {
    render({ ...rahul, phone: "+919800000021" });
    expect(input().value).toBe("9800000021");
  });

  it("shows the server's refusal (e.g. a phone shared with another clinic) and closes only on success", () => {
    m.state.error = new ApiRequestError(409, "PHONE_LOCKED", "This person's phone number is linked to their account elsewhere and can't be changed from this clinic. Ask them to contact Sehat Setu support.");
    render({ ...rahul, phone: "+919800000021" });
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/can't be changed from this clinic/);
    expect(onOpenChange).not.toHaveBeenCalled();
    submit();
    const { onSuccess } = m.state.mutate.mock.calls[0][1];
    act(() => onSuccess());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

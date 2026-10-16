// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IntakeState } from "@/lib/patient-intake";

// The first-login onboarding dialog in a simulated browser. The Server Actions
// are replaced (no network, no database); authorization and persistence are
// covered by intake-actions.test.ts, patient-intake.test.ts and the migration
// tests. Synthetic values only.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; Radix radio buttons measure themselves with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const a = vi.hoisted(() => ({
  saveIntakePersonalAction: vi.fn(),
  saveIntakeMedicalAction: vi.fn(),
  skipIntakeMedicalAction: vi.fn(),
  submitIntakeSymptomsAction: vi.fn(),
  completeIntakeAction: vi.fn(),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(portal)/intake-actions", () => a);
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/portal" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const { PatientOnboardingProvider } = await import("@/components/portal/patient-onboarding");
const { HealthProfileCard, useOnboarding } = await import("@/components/portal/health-profile-card");

const progress = (personalSaved: boolean, medicalReviewed: boolean, completed: boolean) => ({ personalSaved, medicalReviewed, completed });
function state(p = progress(false, false, false), over: Partial<Extract<IntakeState, { available: true }>> = {}): IntakeState {
  return { available: true, completed: p.completed, progress: p, personal: {}, medical: null, appointments: [], recentSymptomReports: 0, ...over };
}
const ok = (s: IntakeState) => ({ ok: true as const, state: s });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  for (const fn of Object.values(a)) fn.mockReset();
  nav.push.mockReset();
  nav.refresh.mockReset();
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = (initial: IntakeState) =>
  act(() =>
    root.render(
      <PatientOnboardingProvider initial={initial}>
        <HealthProfileCard />
      </PatientOnboardingProvider>
    )
  );
const dialog = () => document.querySelector('[data-testid="patient-onboarding"]');
const text = () => document.body.textContent ?? "";
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function type(id: string, value: string) {
  const input = el<HTMLInputElement | HTMLTextAreaElement>(id);
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(async () => void dialog()!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const click = (b: HTMLElement) => act(async () => void b.click());

function fillPersonal() {
  type("legalName", "ZZTEST Patient");
  type("dateOfBirth", "1990-05-17");
  type("phone", "98000 00001");
  type("addressLine", "1 ZZTEST Road");
  type("city", "Pune");
}

describe("when it appears", () => {
  it("opens by itself for a signed-in patient whose profile is incomplete", () => {
    render(state());
    expect(dialog()).not.toBeNull();
    expect(text()).toContain("Step 1 of 3: Personal information");
  });

  it("does not open when the server says onboarding is complete; the card offers editing", async () => {
    render(state(progress(true, true, true)));
    expect(dialog()).toBeNull();
    expect(text()).toContain("Your health profile");
    await click(button("Review or update"));
    expect(text()).toContain("Step 1 of 3");
  });

  it("does not open before the migration exists (no card either)", () => {
    render({ available: false });
    expect(dialog()).toBeNull();
    expect(document.querySelector('[data-testid="health-profile-card"]')).toBeNull();
  });

  it("'Finish later' postpones it for this browser session only; the card resumes it", async () => {
    render(state(progress(true, false, false)));
    expect(text()).toContain("Step 2 of 3: Medical history");
    await click(button("Finish later"));
    expect(dialog()).toBeNull();
    expect(window.sessionStorage.getItem("sehat:intake-dismissed")).toBe("1");
    act(() => root.unmount());
    root = createRoot(host);
    render(state(progress(true, false, false)));
    expect(dialog()).toBeNull();
    await click(button("Continue"));
    expect(text()).toContain("Step 2 of 3");
  });

  it("resumes an interrupted onboarding at the first unsaved step", () => {
    render(state(progress(true, true, false)));
    expect(text()).toContain("Step 3 of 3: Current symptoms");
  });
});

describe("step 1: personal information", () => {
  it("validates in the browser and sends nothing while invalid", async () => {
    render(state());
    type("dateOfBirth", "2999-01-01");
    await submit();
    expect(a.saveIntakePersonalAction).not.toHaveBeenCalled();
    expect(text()).toContain("Enter your full legal name.");
    expect(text()).toContain("can't be in the future");
    expect(el("legalName").getAttribute("aria-invalid")).toBe("true");
  });

  it("saves (phone in E.164) and moves to step 2; a double submit sends once", async () => {
    let resolve!: (v: unknown) => void;
    a.saveIntakePersonalAction.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(state());
    fillPersonal();
    await submit();
    await submit();
    expect(a.saveIntakePersonalAction).toHaveBeenCalledTimes(1);
    expect(a.saveIntakePersonalAction.mock.calls[0][0]).toMatchObject({ legalName: "ZZTEST Patient", phone: "+919800000001", gender: null });
    expect(a.saveIntakePersonalAction.mock.calls[0][0]).not.toHaveProperty("patientId");
    await act(async () => resolve(ok(state(progress(true, false, false)))));
    expect(text()).toContain("Step 2 of 3");
  });

  it("a failed save keeps the answers and shows a retryable error; an expired session offers sign-in", async () => {
    a.saveIntakePersonalAction.mockRejectedValueOnce(new Error("network"));
    render(state());
    fillPersonal();
    await submit();
    expect(text()).toContain("Couldn't reach the server");
    expect(el<HTMLInputElement>("legalName").value).toBe("ZZTEST Patient");
    a.saveIntakePersonalAction.mockResolvedValueOnce({ ok: false, error: "signed_out", message: "Your session has ended. Please sign in again — your saved answers are kept." });
    await submit();
    expect(text()).toContain("Sign in again");
    expect(text()).toContain("Step 1 of 3");
  });
});

describe("step 2: medical history", () => {
  it("can be skipped without changing answers", async () => {
    a.skipIntakeMedicalAction.mockResolvedValueOnce(ok(state(progress(true, true, false))));
    render(state(progress(true, false, false)));
    await click(button("Skip for now"));
    expect(a.skipIntakeMedicalAction).toHaveBeenCalledTimes(1);
    expect(a.saveIntakeMedicalAction).not.toHaveBeenCalled();
    expect(text()).toContain("Step 3 of 3");
  });

  it("'No known allergies' is sent explicitly; unanswered stays NOT_ANSWERED", async () => {
    a.saveIntakeMedicalAction.mockResolvedValue(ok(state(progress(true, true, false))));
    render(state(progress(true, false, false)));
    await submit();
    expect(a.saveIntakeMedicalAction.mock.calls[0][0]).toMatchObject({ allergyStatus: "NOT_ANSWERED", allergies: [] });

    act(() => root.unmount());
    root = createRoot(host);
    render(state(progress(true, false, false)));
    await click(document.getElementById("allergy-NONE_KNOWN")!);
    await submit();
    expect(a.saveIntakeMedicalAction.mock.calls[1][0]).toMatchObject({ allergyStatus: "NONE_KNOWN", allergies: [] });
  });

  it("'I have allergies' needs at least one entry", async () => {
    render(state(progress(true, false, false)));
    await click(document.getElementById("allergy-HAS_ALLERGIES")!);
    await submit();
    expect(a.saveIntakeMedicalAction).not.toHaveBeenCalled();
    expect(text()).toContain("Add at least one allergy");
  });
});

describe("step 3: symptoms and completion", () => {
  it("'Skip and finish' completes without a symptom report and returns to the portal", async () => {
    a.completeIntakeAction.mockResolvedValueOnce(ok(state(progress(true, true, true))));
    render(state(progress(true, true, false)));
    expect(text()).toContain("isn't a diagnosis");
    expect(text()).toContain("112");
    await click(button("Skip and finish"));
    expect(a.submitIntakeSymptomsAction).not.toHaveBeenCalled();
    expect(a.completeIntakeAction).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
    // Stays on the page it was opened from (e.g. My Health Profile): no jump to Home.
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("partly filled symptoms are validated, not silently dropped", async () => {
    render(state(progress(true, true, false)));
    type("reason", "Cough");
    await submit();
    expect(a.submitIntakeSymptomsAction).not.toHaveBeenCalled();
    expect(a.completeIntakeAction).not.toHaveBeenCalled();
    expect(text()).toContain("Describe your symptoms.");
    expect(text()).toContain("Choose when your symptoms started.");
  });

  it("without upcoming appointments, says the answers are kept for the next visit; with earlier reports, says they are kept", () => {
    render(state(progress(true, true, false), { recentSymptomReports: 2 }));
    expect(text()).toContain("You have no upcoming appointments");
    expect(text()).toContain("earlier answers are kept");
  });

  it("closing with unsaved changes asks for confirmation", async () => {
    render(state());
    type("legalName", "ZZTEST Patient");
    await click(button("Finish later"));
    expect(text()).toContain("Discard unsaved changes?");
    expect(dialog()).not.toBeNull();
  });
});

describe("editing one section later (My Health Profile)", () => {
  function EditButtons() {
    const o = useOnboarding();
    return (
      <>
        <button type="button" onClick={() => o?.openAt(1, { section: true })}>edit personal</button>
        <button type="button" onClick={() => o?.openAt(2, { section: true })}>edit medical</button>
        <span data-testid="snapshot">{o ? `${o.state.progress.medicalReviewed}` : "none"}</span>
      </>
    );
  }
  const renderEdit = (initial: IntakeState) =>
    act(() => root.render(<PatientOnboardingProvider initial={initial}><EditButtons /></PatientOnboardingProvider>));
  const saved = () =>
    state(progress(true, true, true), {
      personal: { legalName: "ZZTEST Patient", dateOfBirth: "1990-05-17", gender: "FEMALE", phone: "+91 98000 00001", addressLine: "1 ZZTEST Road", city: "Pune" },
      medical: { allergyStatus: "UNKNOWN", allergies: [], medications: [], conditions: [], pastSurgeries: null, familyHistory: null },
    });

  it("loads the saved answers (a phone stored with spaces too), saves just that section and closes — no wizard, no completion call, no navigation", async () => {
    renderEdit(saved());
    await click(button("edit personal"));
    expect(dialog()).not.toBeNull();
    expect(el<HTMLInputElement>("legalName").value).toBe("ZZTEST Patient");
    expect(el<HTMLInputElement>("phone").value).toBe("9800000001");
    expect(text()).not.toContain("Step 1 of 3");
    type("city", "Mumbai");
    a.saveIntakePersonalAction.mockResolvedValueOnce(ok(saved()));
    await click(button("Save changes"));
    expect(a.saveIntakePersonalAction).toHaveBeenCalledWith(expect.objectContaining({ city: "Mumbai", phone: "+919800000001" }));
    expect(dialog()).toBeNull();
    expect(a.saveIntakeMedicalAction).not.toHaveBeenCalled();
    expect(a.completeIntakeAction).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("allergy states stay distinct: 'Unknown' is loaded as Unknown and sent as UNKNOWN, never as 'none'", async () => {
    renderEdit(saved());
    await click(button("edit medical"));
    a.saveIntakeMedicalAction.mockResolvedValueOnce(ok(saved()));
    await click(button("Save changes"));
    expect(a.saveIntakeMedicalAction).toHaveBeenCalledWith(expect.objectContaining({ allergyStatus: "UNKNOWN", allergies: [] }));
    expect(dialog()).toBeNull();
  });

  it("a failed save keeps what was typed and stays open with the error", async () => {
    renderEdit(saved());
    await click(button("edit personal"));
    type("city", "Nashik");
    a.saveIntakePersonalAction.mockResolvedValueOnce({ ok: false, error: "unavailable", message: "Couldn't save right now." });
    await click(button("Save changes"));
    expect(dialog()).not.toBeNull();
    expect(text()).toContain("Couldn't save right now.");
    expect(el<HTMLInputElement>("city").value).toBe("Nashik");
  });

  it("a newer server snapshot (after a refresh) replaces the one loaded with the page", () => {
    renderEdit(state(progress(true, false, false)));
    expect(document.querySelector('[data-testid="snapshot"]')?.textContent).toBe("false");
    renderEdit(saved());
    expect(document.querySelector('[data-testid="snapshot"]')?.textContent).toBe("true");
  });
});

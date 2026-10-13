// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const { AuthFragmentGuard } = await import("./auth-fragment-guard");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderAt(url: string) {
  window.history.replaceState(null, "", url);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(AuthFragmentGuard)));
  root.unmount();
}

afterEach(() => replace.mockReset());

describe("AuthFragmentGuard", () => {
  it("strips implicit-flow tokens from the URL without using them, and redirects", async () => {
    await renderAt("/?x=1#access_token=FAKE_ACCESS&refresh_token=FAKE_REFRESH&type=invite");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("FAKE_");
    expect(window.location.search).toBe("?x=1");
    expect(replace).toHaveBeenCalledWith("/login?reason=link_unsupported");
  });

  it("treats an expired-link error as an invalid link", async () => {
    await renderAt("/#error=access_denied&error_code=otp_expired&error_description=expired");
    expect(window.location.hash).toBe("");
    expect(replace).toHaveBeenCalledWith("/login?reason=link_invalid");
  });

  it("leaves ordinary page anchors alone", async () => {
    await renderAt("/how-it-works#faq");
    expect(window.location.hash).toBe("#faq");
    expect(replace).not.toHaveBeenCalled();
  });
});

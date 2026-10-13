import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";

// The live notification page's states, with the feed hook controlled (server
// rendering can't run a failing request). The demo store must never be touched.

const mockNotif = vi.hoisted(() => ({ listNotifications: vi.fn(), getUnreadCount: vi.fn(), markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn() }));
vi.mock("@/services/notifications", () => mockNotif);
vi.mock("@/lib/auth/config", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/config")>()), isSupabaseAuthEnabled: () => true }));

const feed = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-notifications", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-notifications")>()),
  useLiveNotificationFeed: () => feed.state,
}));

const { default: NotificationsPage } = await import("@/app/(app)/notifications/page");

const render = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LiveDataProvider live>
        <NotificationsPage />
      </LiveDataProvider>
    </QueryClientProvider>
  );

const base = { data: undefined, isLoading: false, isError: false, error: null, hasNextPage: false, isFetchingNextPage: false, dataUpdatedAt: 0, refetch: vi.fn(), fetchNextPage: vi.fn() };

describe("live notifications page states", () => {
  it("a failed request shows an error with retry, not 'all caught up'", () => {
    feed.state = { ...base, isError: true, error: new ApiRequestError(500, "INTERNAL", "Something went wrong.") };
    const html = render();
    expect(html).toContain("Couldn&#x27;t load notifications");
    expect(html).toContain("Try again");
    expect(html).not.toContain("all caught up");
  });

  it("before the migration is applied: a clear unavailable state, nothing fabricated", () => {
    feed.state = { ...base, isError: true, error: new ApiRequestError(503, "FEATURE_UNAVAILABLE", "Notifications aren't set up.") };
    expect(render()).toContain("Notifications aren&#x27;t available yet");
  });

  it("a genuinely empty list says so", () => {
    feed.state = { ...base, data: { pages: [{ items: [], nextCursor: null }] } };
    expect(render()).toContain("all caught up");
  });

  it("renders server-provided text and offers paging", () => {
    feed.state = {
      ...base,
      dataUpdatedAt: Date.now(),
      hasNextPage: true,
      data: { pages: [{ items: [{ id: "n1", type: "stock_low", title: "Low stock", body: "Paracetamol is down to 3 usable units.", link: "/inventory/b/m", createdAt: new Date().toISOString(), read: false }], nextCursor: "c" }] },
    };
    const html = render();
    expect(html).toContain("Low stock");
    expect(html).toContain("Load more");
    expect(html).toContain('href="/inventory/b/m"');
  });

  it("never reads the demo store", () => {
    feed.state = { ...base, isLoading: true };
    render();
    expect(mockNotif.listNotifications).not.toHaveBeenCalled();
    expect(mockNotif.getUnreadCount).not.toHaveBeenCalled();
  });
});

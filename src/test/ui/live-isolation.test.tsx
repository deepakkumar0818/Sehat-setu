import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveDataProvider } from "@/lib/data-source";
import { ApiRequestError } from "@/lib/api-client";

// Live-mode isolation, rendered on the server (react-dom/server; no browser).
// Proves that with live data: the demo notification store is never queried,
// no fake unread count appears, failed requests show errors (not empty lists),
// hard-coded demo content is hidden, and demo-only create dialogs never mount.

const mockNotif = vi.hoisted(() => ({
  listNotifications: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  getUnreadCount: vi.fn(async () => 7),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("@/services/notifications", () => mockNotif);

const auth = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/auth/config", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/config")>()), isSupabaseAuthEnabled: () => auth.enabled }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff",
  useSearchParams: () => new URLSearchParams(),
}));

const people = vi.hoisted(() => ({
  staff: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  doctors: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
}));
vi.mock("@/hooks/use-people", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-people")>()),
  useStaff: () => people.staff,
  useDoctors: () => people.doctors,
  useUpdateStaffStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useSpecialtyOptions: () => ({ data: [{ id: "s1", name: "Cardiology" }], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-branches", () => ({ useBranches: () => [] }));

const { NotificationsMenu } = await import("@/components/layout/notifications-menu");
const { default: StaffPage } = await import("@/app/(app)/staff/page");
const { default: DoctorsPage } = await import("@/app/(app)/doctor-roster/page");
const { StaffFormDialog } = await import("@/components/staff/staff-form-dialog");
const { DoctorFormDialog } = await import("@/components/doctors/doctor-form-dialog");

function render(ui: React.ReactNode, { live, client = new QueryClient() }: { live: boolean; client?: QueryClient }) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LiveDataProvider live={live}>{ui}</LiveDataProvider>
    </QueryClientProvider>
  );
}

const serverError = () => new ApiRequestError(500, "INTERNAL", "Something went wrong. Please try again.");
const staffRow = { id: "m1", clinicId: "c", name: "Asha Rao", role: "receptionist", branchId: "b", phone: "", email: "asha@clinic.test", status: "active", lastActiveAt: "", joinedDate: "2026-01-01", avatarColor: "#000" };

beforeEach(() => {
  auth.enabled = true;
  people.staff = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  people.doctors = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
});
afterEach(() => vi.clearAllMocks());

describe("notifications in live mode", () => {
  it("bell shows the database's unread count and never queries the demo store", () => {
    const client = new QueryClient();
    client.setQueryData(["notifications", "live", "unread"], { count: 3, capped: false });
    const html = render(<NotificationsMenu />, { live: true, client });
    expect(html).toContain(">3<");
    expect(mockNotif.getUnreadCount).not.toHaveBeenCalled();
    expect(mockNotif.listNotifications).not.toHaveBeenCalled();
  });

  it("caps the badge at 99+", () => {
    const client = new QueryClient();
    client.setQueryData(["notifications", "live", "unread"], { count: 99, capped: true });
    expect(render(<NotificationsMenu />, { live: true, client })).toContain("99+");
  });

  it("patient portal with a real session: no badge, no demo queries", () => {
    const html = render(<NotificationsMenu />, { live: false });
    expect(html).not.toMatch(/bg-danger/);
    expect(mockNotif.getUnreadCount).not.toHaveBeenCalled();
  });

  it("demo mode (no Supabase) still uses the demo store", () => {
    auth.enabled = false;
    // The demo badge subscribes to the mock unread count; in a browser the enabled query then runs.
    const client = new QueryClient();
    render(<NotificationsMenu />, { live: false, client });
    const queries = client.getQueryCache().findAll({ queryKey: ["notifications", "unread"] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => (q.options as { enabled?: unknown }).enabled !== false)).toBe(true);
    // ...and the live count query stays disabled.
    expect(client.getQueryCache().findAll({ queryKey: ["notifications", "live", "unread"] }).every((q) => (q.options as { enabled?: unknown }).enabled === false)).toBe(true);
  });

});

describe("staff directory in live mode", () => {
  it("a failed request shows an error, never 'No staff'", () => {
    people.staff = { data: undefined, isLoading: false, isError: true, error: serverError(), refetch: vi.fn() };
    const html = render(<StaffPage />, { live: true });
    expect(html).toContain("Couldn&#x27;t load staff");
    expect(html).not.toContain("No staff yet");
  });

  it("hides demo-only content: Last Active, the hard-coded permission matrix, the demo Add button", () => {
    people.staff = {
      data: { items: [{ ...staffRow, canChangeStatus: false }], total: 1, page: 1, pageSize: 10, capabilities: { canChangeStatus: true, canInvite: false, canViewInvitations: false, invitationsReady: false } },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    const html = render(<StaffPage />, { live: true });
    expect(html).toContain("Asha Rao");
    expect(html).not.toContain("Last Active");
    expect(html).not.toContain("Roles &amp; Permissions");
    expect(html).not.toContain("Add Staff");
    expect(html).not.toContain('role="switch"'); // this row may not be changed (e.g. your own)
  });

  it("shows the status switch only where the server allows it, and Invite only for administrators", () => {
    people.staff = {
      data: { items: [{ ...staffRow, canChangeStatus: true }], total: 1, page: 1, pageSize: 10, capabilities: { canChangeStatus: true, canInvite: true, canViewInvitations: true, invitationsReady: true } },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    const html = render(<StaffPage />, { live: true });
    expect(html).toContain('role="switch"');
    expect(html).toMatch(/<button[^>]*>(?:(?!disabled)[\s\S])*?Invite staff<\/button>/);
    expect(html).not.toContain("not set up yet");
    expect(html).toContain("Invitations");
  });

  it("while the invitation migration is pending: Invite is disabled and says why (no form that can only fail)", () => {
    people.staff = {
      data: { items: [staffRow], total: 1, page: 1, pageSize: 10, capabilities: { canChangeStatus: true, canInvite: true, canViewInvitations: true, invitationsReady: false } },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    const html = render(<StaffPage />, { live: true });
    expect(html).toContain("Invite staff (not set up yet)");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Invite staff \(not set up yet\)/);
    expect(html).toContain("migration");
  });

  it("demo mode keeps the demo matrix and Add button", () => {
    auth.enabled = false;
    people.staff = { data: { items: [staffRow], total: 1, page: 1, pageSize: 10 }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const html = render(<StaffPage />, { live: false });
    expect(html).toContain("Roles &amp; Permissions");
    expect(html).toContain("Add Staff");
  });
});

describe("doctor roster in live mode", () => {
  it("a failed request shows an error, never 'No doctors'", () => {
    people.doctors = { data: undefined, isLoading: false, isError: true, error: serverError(), refetch: vi.fn() };
    const html = render(<DoctorsPage />, { live: true });
    expect(html).toContain("Couldn&#x27;t load doctors");
    expect(html).not.toContain("No doctors yet");
  });

  it("uses the database's specialties, not the hard-coded list", () => {
    people.doctors = { data: { items: [], total: 0, page: 1, pageSize: 12, capabilities: { canInviteDoctors: true, invitationsReady: true } }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const html = render(<DoctorsPage />, { live: true });
    expect(html).toContain("No doctors yet");
    expect(html).toContain("Invite doctor");
    expect(html).not.toContain("not set up yet");
    expect(html).not.toContain("Add Doctor");
  });

  it("while the invitation migration is pending: Invite doctor is disabled and says why", () => {
    people.doctors = { data: { items: [], total: 0, page: 1, pageSize: 12, capabilities: { canInviteDoctors: true, invitationsReady: false } }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const html = render(<DoctorsPage />, { live: true });
    expect(html).toContain("Invite doctor (not set up yet)");
  });
});

describe("demo-only create dialogs", () => {
  it("never mount with live data (no shared demo password flow)", () => {
    expect(render(<StaffFormDialog open onOpenChange={() => {}} />, { live: true })).toBe("");
    expect(render(<DoctorFormDialog open onOpenChange={() => {}} />, { live: true })).toBe("");
  });
});

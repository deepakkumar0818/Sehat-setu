import { Suspense } from "react";
import { CalendarXIcon } from "lucide-react";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { istGreeting, istTodayKey } from "@/lib/ist";
import { requireStaffContext } from "@/server/auth/session";
import { getDashboardData } from "@/server/data/dashboard";
import type { TenantContext } from "@/server/auth/authorize";
import { DemoDashboardPage } from "@/components/dashboard/demo-dashboard-page";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { EmptyState } from "@/components/shared/empty-state";
import DashboardLoading from "./loading";

// With Supabase Auth: a server component that reads the dashboard from
// PostgreSQL for the verified clinic/branch/role (see src/server/data/dashboard.ts).
// Demo mode: the original client dashboard over the in-browser mock data.
export default async function DashboardPage() {
  if (!isSupabaseAuthEnabled()) return <DemoDashboardPage />;
  const ctx = await requireStaffContext(); // already verified by the segment layout; cached per request
  return (
    <Suspense fallback={<DashboardLoading />}>
      <LiveDashboardSection ctx={ctx} />
    </Suspense>
  );
}

function displayName(ctx: TenantContext): string {
  const parts = ctx.name.replace(/^Dr\.\s*/, "").trim().split(/\s+/);
  return ctx.roles.includes("DOCTOR") ? `Dr. ${parts[parts.length - 1]}` : parts[0];
}

async function LiveDashboardSection({ ctx }: { ctx: TenantContext }) {
  if (ctx.careScope === "none") {
    return (
      <EmptyState
        icon={CalendarXIcon}
        title="No schedule access"
        description="Your role doesn't include appointments, so there's nothing to show on the dashboard yet."
      />
    );
  }
  const data = await getDashboardData(ctx);
  const now = new Date();
  return <LiveDashboard data={data} greeting={istGreeting(now)} name={displayName(ctx)} today={istTodayKey(now)} />;
}

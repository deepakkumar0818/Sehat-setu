"use client";

import { usePathname } from "next/navigation";
import { ClockIcon } from "lucide-react";
import { AuthGate } from "@/components/layout/auth-gate";
import { PortalSidebar } from "@/components/portal/portal-sidebar";
import { PortalHeader } from "@/components/portal/portal-header";
import { PortalBottomNav } from "@/components/portal/portal-bottom-nav";
import { EmptyState } from "@/components/shared/empty-state";
import { LiveDataProvider } from "@/lib/data-source";
import { isLivePortalPath } from "@/lib/nav-config";
import type { ServerSessionUser } from "@/lib/auth/session-user";
import type { IntakeState } from "@/lib/patient-intake";
import { PatientOnboardingProvider } from "@/components/portal/patient-onboarding";

// With a real signed-in patient (Supabase mode) the portal reads the clinic
// database: Home, Lab reports and Documents (P6.3). Every other portal page is
// not built on real data yet, so it shows a "not available" notice instead of
// demo data. Demo mode (no server user) keeps the original mock portal.
// The header stays OUTSIDE the live flag on purpose: its notification bell must
// keep its "unavailable" state for patients (staff notifications are staff-only).
// `intake` (live patients only): the server-side onboarding state (P6.5). The
// first-login dialog opens from it while the profile is incomplete.
export function PortalShell({ serverUser, intake = null, children }: { serverUser: ServerSessionUser | null; intake?: IntakeState | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const live = Boolean(serverUser);
  const available = !live || isLivePortalPath(pathname);

  const shell = (
    <AuthGate mode="portal" serverUser={serverUser}>
      <div className="flex min-h-svh">
        <LiveDataProvider live={live}>
          <div className="print:hidden"><PortalSidebar /></div>
        </LiveDataProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="print:hidden"><PortalHeader live={live} /></div>
          <LiveDataProvider live={live}>
            <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-20 pt-5 sm:px-6 md:pb-8 print:max-w-none print:p-0">
              {available ? (
                children
              ) : (
                <EmptyState
                  icon={ClockIcon}
                  title="Not available yet"
                  description="This part of the patient portal isn't connected to your clinic's records yet. Your appointments, health profile, reports, documents and bills are available from the menu."
                />
              )}
            </main>
            <div className="print:hidden"><PortalBottomNav /></div>
          </LiveDataProvider>
        </div>
      </div>
    </AuthGate>
  );
  return live && intake ? <PatientOnboardingProvider initial={intake}>{shell}</PatientOnboardingProvider> : shell;
}

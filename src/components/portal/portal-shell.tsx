"use client";

import { AuthGate } from "@/components/layout/auth-gate";
import { PortalSidebar } from "@/components/portal/portal-sidebar";
import { PortalHeader } from "@/components/portal/portal-header";
import { PortalBottomNav } from "@/components/portal/portal-bottom-nav";
import type { ServerSessionUser } from "@/lib/auth/session-user";
import { DemoDataNotice } from "@/components/shared/not-connected";

export function PortalShell({ serverUser, children }: { serverUser: ServerSessionUser | null; children: React.ReactNode }) {
  return (
    <AuthGate mode="portal" serverUser={serverUser}>
      <div className="flex min-h-svh">
        <div className="print:hidden"><PortalSidebar /></div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="print:hidden"><PortalHeader /></div>
          <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-20 pt-5 sm:px-6 md:pb-8 print:max-w-none print:p-0">
            {/* The portal's pages still read the in-browser demo store (P6/P7). With a real
                signed-in patient, say so on every page so nothing is mistaken for their records. */}
            {serverUser && <DemoDataNotice />}
            {children}
          </main>
          <div className="print:hidden"><PortalBottomNav /></div>
        </div>
      </div>
    </AuthGate>
  );
}

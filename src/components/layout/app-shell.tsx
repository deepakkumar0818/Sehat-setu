"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { AuthGate } from "@/components/layout/auth-gate";
import { usePathname } from "next/navigation";
import { LiveDataProvider, isLiveRoute } from "@/lib/data-source";
import { DemoDataNotice } from "@/components/shared/not-connected";
import { PendingInvitationsBanner } from "@/components/invitations/pending-invitations-banner";
import type { ServerSessionUser } from "@/lib/auth/session-user";

export function AppShell({ serverUser, children }: { serverUser: ServerSessionUser | null; children: React.ReactNode }) {
  // A server-verified user exists only in Supabase Auth mode: that's when pages read the clinic database.
  const live = serverUser !== null;
  const pathname = usePathname();
  return (
    <LiveDataProvider live={live}>
      <AuthGate mode="staff" serverUser={serverUser}>
        <SidebarProvider>
          <div className="print:hidden">
            <AppSidebar />
          </div>
          <SidebarInset>
            <div className="print:hidden">
              <TopHeader />
            </div>
            <main className="flex-1 px-4 pb-20 pt-5 sm:px-6 md:pb-8 print:p-0">
              {live && !isLiveRoute(pathname) && <DemoDataNotice />}
              <PendingInvitationsBanner />
              {children}
            </main>
            <div className="print:hidden">
              <MobileBottomNav />
            </div>
          </SidebarInset>
          <CommandPalette />
        </SidebarProvider>
      </AuthGate>
    </LiveDataProvider>
  );
}

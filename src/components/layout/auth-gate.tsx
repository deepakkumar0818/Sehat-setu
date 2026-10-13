"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { getDb, useDataStore } from "@/store/data-store";
import { resolveDemoUser } from "@/lib/auth";
import type { ServerSessionUser } from "@/lib/auth/session-user";
import type { AuthUser } from "@/types";
import { FullPageLoading } from "@/components/shared/full-page-loading";

interface AuthGateProps {
  mode: "staff" | "portal";
  /**
   * The identity the server verified for this request (Supabase Auth mode).
   * When present it is the ONLY source of who the user is; anything left in
   * localStorage from a previous session is overwritten. Absent in demo mode.
   */
  serverUser?: ServerSessionUser | null;
  children: React.ReactNode;
}

/**
 * Binds the server-verified identity to the existing UI. Pages still render the
 * fictional mock dataset, so the user is also attached to the mock record for
 * their role (resolveDemoUser) purely for display — that binding grants no
 * access to anything real; every database read re-verifies on the server.
 */
function bridgeServerUser(serverUser: ServerSessionUser): AuthUser {
  return { ...resolveDemoUser(serverUser.role, getDb()), id: serverUser.userId, name: serverUser.name, email: serverUser.email };
}

export function AuthGate({ mode, serverUser, children }: AuthGateProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const dbHydrated = useDataStore((s) => s.hasHydrated);
  const ready = authHydrated && dbHydrated;
  const isMismatched = Boolean(user) && ((mode === "staff" && user!.role === "patient") || (mode === "portal" && user!.role !== "patient"));

  // Server-verified mode: mirror the server's identity into the client store.
  useEffect(() => {
    if (!serverUser || !ready) return;
    const current = useAuthStore.getState().user;
    if (current?.id !== serverUser.userId || current.role !== serverUser.role) {
      useAuthStore.setState({ user: bridgeServerUser(serverUser) });
    }
  }, [serverUser, ready]);

  // Demo mode only: the client-side persona decides routing, as before.
  useEffect(() => {
    if (serverUser || !ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (mode === "staff" && user.role === "patient") {
      router.replace("/portal");
      return;
    }
    if (mode === "portal" && user.role !== "patient") {
      router.replace("/dashboard");
    }
  }, [serverUser, ready, user, mode, router]);

  if (serverUser) {
    if (!ready || user?.id !== serverUser.userId || user.role !== serverUser.role) return <FullPageLoading />;
    return <>{children}</>;
  }

  if (!ready || !user || isMismatched) {
    return <FullPageLoading />;
  }

  return <>{children}</>;
}

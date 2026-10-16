"use client";

import { LivePortalSettings } from "@/components/portal/live-portal-settings";
import { EmptyState } from "@/components/shared/empty-state";
import { useLiveData } from "@/lib/data-source";

// Account settings: signed-in patients only (demo mode has no real account).
export default function PortalSettingsPage() {
  return useLiveData() ? <LivePortalSettings /> : <EmptyState title="Account settings" description="Sign in with a real account to manage your password and sign-in." />;
}

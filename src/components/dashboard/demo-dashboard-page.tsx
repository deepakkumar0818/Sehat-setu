"use client";

import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { DoctorDashboard } from "@/components/dashboard/doctor-dashboard";
import { FullPageLoading } from "@/components/shared/full-page-loading";
import { useCurrentUser } from "@/hooks/use-current-user";

/** The original dashboard over the in-browser mock dataset — used in demo mode (no Supabase Auth). */
export function DemoDashboardPage() {
  const user = useCurrentUser();
  if (!user) return <FullPageLoading />;
  return user.role === "doctor" ? <DoctorDashboard user={user} /> : <AdminDashboard user={user} />;
}

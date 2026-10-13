"use client";

import { DemoAnalytics } from "@/components/analytics/demo-analytics";
import { LiveReports } from "@/components/analytics/live-reports";
import { useLiveData } from "@/lib/data-source";

export default function AnalyticsPage() {
  // Live (Supabase mode): clinic reports from the database. Demo mode: the original mock analytics.
  return useLiveData() ? <LiveReports /> : <DemoAnalytics />;
}

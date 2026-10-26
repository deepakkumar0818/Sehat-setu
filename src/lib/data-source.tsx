"use client";

import { createContext, useContext, useMemo } from "react";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import { istTodayKey } from "@/lib/ist";

// Where staff-app hooks read data from. The authenticated staff shell sets
// "live" (Supabase Auth mode): migrated hooks call /api/v1 and never touch the
// in-browser mock store. Everything else — demo mode, the public site, the
// patient portal — keeps the default, mock.

const LiveDataContext = createContext(false);

export function LiveDataProvider({ live, children }: { live: boolean; children: React.ReactNode }) {
  return <LiveDataContext.Provider value={live}>{children}</LiveDataContext.Provider>;
}

export function useLiveData(): boolean {
  return useContext(LiveDataContext);
}

/** "Now" for date defaults: real time with live data, the fixed demo clock with mock data. */
export function useAppNow(): Date {
  const live = useLiveData();
  return useMemo(() => (live ? new Date() : DEMO_NOW), [live]);
}

/** Today's date (yyyy-MM-dd): IST calendar day with live data, the demo day with mock data. */
export function useTodayKey(): string {
  const live = useLiveData();
  return live ? istTodayKey(new Date()) : todayDateStr();
}

/** Staff-app routes whose data comes from the clinic database. Others show a demo-data notice in live mode. */
export const LIVE_ROUTE_PREFIXES = ["/dashboard", "/patients", "/appointments", "/waiting-room", "/doctor-roster", "/staff", "/billing", "/consultations", "/prescriptions", "/inventory", "/notifications", "/analytics", "/reports", "/documents", "/clinic/branches", "/clinic/departments", "/clinic/lab-tests", "/clinic/specialties", "/clinic/users", "/audit-log", "/expenses", "/subscription", "/settings"] as const;

export function isLiveRoute(pathname: string): boolean {
  return LIVE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

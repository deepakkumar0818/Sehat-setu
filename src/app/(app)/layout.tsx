import { AppShell } from "@/components/layout/app-shell";
import { guardStaffRoute, toServerSessionUser } from "@/server/auth/session";

// Server layout: with Supabase Auth configured, the session and an active
// staff membership are verified here (and per segment in each child
// layout.tsx) before any staff page renders. In demo mode guardStaffRoute
// returns null and the client-side demo persona gate applies as before.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await guardStaffRoute(null);
  return <AppShell serverUser={ctx ? toServerSessionUser(ctx) : null}>{children}</AppShell>;
}

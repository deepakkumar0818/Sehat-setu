import { PortalShell } from "@/components/portal/portal-shell";
import { guardPortalRoute, toPortalSessionUser } from "@/server/auth/session";

// Server layout: with Supabase Auth configured, only a verified user with an
// active PATIENT membership gets in. Demo mode falls back to the client gate.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const patient = await guardPortalRoute();
  return <PortalShell serverUser={patient ? toPortalSessionUser(patient) : null}>{children}</PortalShell>;
}

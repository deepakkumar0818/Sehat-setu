import { PortalShell } from "@/components/portal/portal-shell";
import { guardPortalRoute, toPortalSessionUser } from "@/server/auth/session";
import { getIntakeState } from "@/server/data/patient-intake";
import { logServerError } from "@/server/log";
import type { IntakeState } from "@/lib/patient-intake";

// Server layout: with Supabase Auth configured, only a verified user with an
// active PATIENT membership gets in. Demo mode falls back to the client gate.
// For a signed-in patient it also reads the first-login onboarding state (P6.5)
// from the database; if that fails, the portal still works without it.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const patient = await guardPortalRoute();
  let intake: IntakeState | null = null;
  if (patient) {
    try {
      intake = await getIntakeState(patient);
    } catch (err) {
      logServerError("portal intake state", err);
    }
  }
  return (
    <PortalShell serverUser={patient ? toPortalSessionUser(patient) : null} intake={intake}>
      {children}
    </PortalShell>
  );
}

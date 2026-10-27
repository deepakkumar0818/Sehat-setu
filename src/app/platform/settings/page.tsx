import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { guardPlatformRoute } from "@/server/auth/session";
import { PlatformSettings } from "@/components/platform/platform-settings";

export default async function PlatformSettingsPage() {
  // The layout has already checked access; this reads the signed-in super admin's name and email.
  const identity = isSupabaseAuthEnabled() ? await guardPlatformRoute() : null;
  return <PlatformSettings name={identity?.name ?? ""} email={identity?.email ?? ""} />;
}

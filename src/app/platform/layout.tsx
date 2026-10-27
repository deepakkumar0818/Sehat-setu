import { notFound } from "next/navigation";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { guardPlatformRoute } from "@/server/auth/session";
import { PlatformShell } from "@/components/platform/platform-shell";

export const metadata = { title: "Platform — Sehat Setu" };

// Server layout: only a verified, ACTIVE Sehat Setu super admin gets in
// (platform_admins, checked against the signed-in login). There is no demo
// version: the console exists only with the clinic database.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseAuthEnabled()) notFound();
  const identity = await guardPlatformRoute();
  return <PlatformShell name={identity?.name ?? ""} email={identity?.email ?? ""}>{children}</PlatformShell>;
}

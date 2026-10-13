import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/server/auth/errors";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { noMembershipRedirect } from "@/server/auth/session";

export const metadata = { title: "Access denied — Sehat Setu" };

/** Where server-side guards send a signed-in user who isn't allowed in (see authErrorDestination). */
export default async function AccessDeniedPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  // Landed here directly (bookmark, old link) with a pending invitation: go and accept it.
  if (reason === "no_membership" && isSupabaseAuthEnabled()) {
    const destination = await noMembershipRedirect();
    if (destination) redirect(destination);
  }
  const message = authErrorMessage(reason?.toUpperCase()) ?? "You don't have permission to view that page.";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 text-center">
      <ShieldAlertIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Access denied</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {reason === "no_membership" && (
          <Button asChild>
            <Link href="/invitations">Check for invitations</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost">
            Sign in as someone else
          </Button>
        </form>
      </div>
    </div>
  );
}

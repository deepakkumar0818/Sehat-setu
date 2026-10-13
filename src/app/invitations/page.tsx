import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { MailIcon } from "lucide-react";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { requireIdentity, authErrorDestination } from "@/server/auth/session";
import { isAuthError } from "@/server/auth/errors";
import { PendingInvitations } from "@/components/invitations/pending-invitations";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Your invitations — Sehat Setu" };

/**
 * Pending staff invitations for the signed-in user. Needs only a verified,
 * linked account — not a clinic membership (accepting creates that).
 */
export default async function InvitationsPage() {
  await connection();
  if (!isSupabaseAuthEnabled()) notFound(); // invitations exist only with the clinic database
  try {
    await requireIdentity();
  } catch (err) {
    if (isAuthError(err)) redirect(authErrorDestination(err, "/invitations"));
    throw err;
  }
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <MailIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Your invitations</h1>
        <p className="text-sm text-muted-foreground">Accept an invitation to join that clinic. You won&apos;t see any clinic information until you do.</p>
      </div>
      <div className="w-full max-w-md">
        <PendingInvitations />
      </div>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="ghost">Sign in as someone else</Button>
      </form>
    </div>
  );
}

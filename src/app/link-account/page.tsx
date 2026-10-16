import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { isAuthError } from "@/server/auth/errors";
import { homeFor } from "@/server/auth/authorize";
import { authErrorDestination, requireAuthUser, requireIdentity } from "@/server/auth/session";
import { registerSelfPatient } from "@/server/data/patient-link";
import { selfRegistrationSchema, type SelfRegisterResult } from "@/server/data/patient-link-rules";
import { reportEvent, reportServerError } from "@/server/monitoring";
import { CompleteRegistrationForm } from "./complete-registration-form";
import { LinkAccountForm } from "./link-account-form";

export const metadata = { title: "Link your patient record — Sehat Setu" };

/**
 * Where a signed-in login with no application account lands.
 *  * An EXISTING clinic record is linked only with the clinic's single-use code
 *    (after the front desk checks the patient's identity) — never by email.
 *  * A NEW patient (no record carries their email) gets a record created from
 *    the details they registered with, in the configured clinic, and goes to
 *    the portal. Without saved details they're asked for them here.
 * Needs a signed-in, email-confirmed login.
 */
export default async function LinkAccountPage() {
  await connection();
  if (!isSupabaseAuthEnabled()) notFound(); // linking exists only with the clinic database
  let authUser;
  try {
    authUser = await requireAuthUser();
  } catch (err) {
    if (isAuthError(err)) redirect(authErrorDestination(err, "/link-account"));
    throw err;
  }
  // Already set up: straight to the right place.
  const identity = await requireIdentity().catch(() => null);
  if (identity?.patientLinks?.length && homeFor(identity) === "portal") redirect("/portal");
  if (identity && homeFor(identity) === "staff") redirect("/dashboard");

  const confirmed = authUser.emailConfirmed && Boolean(authUser.email);
  const details = selfRegistrationSchema.safeParse(authUser.metadata ?? {});
  let result: SelfRegisterResult | "unavailable" | null = null;
  if (confirmed && details.success) {
    try {
      result = (await registerSelfPatient(authUser, details.data)).result;
    } catch (err) {
      console.error("[link-account] self registration failed", err instanceof Error ? err.name : "error");
      reportServerError("page link_account", err);
      result = "unavailable";
    }
    if (result === "LINKED" || result === "ALREADY_LINKED") redirect("/portal");
    if (result === "NEEDS_CODE" || result === "NOT_ELIGIBLE") reportEvent("link_code_failure", { scope: "auto_register", reason: result });
  }
  const askForDetails = confirmed && !details.success;

  const message = !confirmed
    ? `Confirm your email address first — enter the code we emailed${authUser.email ? ` to ${authUser.email}` : ""} on the registration page, then sign in again.`
    : result === "NEEDS_CODE"
      ? "Your clinic already has a patient record with this email. To connect it, ask the front desk for a portal linking code — they'll check your identity first — and enter it below."
      : result === "NOT_ELIGIBLE"
        ? "Your account can't be set up automatically. Please contact your clinic's front desk, or enter a linking code if they gave you one."
        : result === "unavailable"
          ? "Couldn't set up your account right now. Please try again in a moment."
          : "Have a linking code from your clinic? Enter it below. New patient? Tell us a few details instead.";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <LinkIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Link your patient record</h1>
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
      {confirmed && (
        <div className="w-full max-w-sm space-y-6 text-left">
          <section aria-labelledby="code-heading" className="space-y-2">
            <h2 id="code-heading" className="text-sm font-medium text-foreground">
              Existing patient — linking code
            </h2>
            <LinkAccountForm />
          </section>
          {askForDetails && (
            <section aria-labelledby="details-heading" className="space-y-2 border-t pt-5">
              <h2 id="details-heading" className="text-sm font-medium text-foreground">
                New patient — your details
              </h2>
              <CompleteRegistrationForm />
            </section>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {result === "unavailable" && (
          <Button asChild>
            <Link href="/link-account">Try again</Link>
          </Button>
        )}
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      </div>
      <p className="max-w-sm text-xs text-muted-foreground">
        Staff member? Your account comes from an <Link href="/invitations" className="underline">invitation</Link> instead.
      </p>
    </div>
  );
}

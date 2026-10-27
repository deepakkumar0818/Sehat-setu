"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, KeyRoundIcon, LogOutIcon, MailIcon, ShieldCheckIcon, UserIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { usePlatformSettings } from "@/hooks/use-platform";
import { formatDate } from "@/lib/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ChangePasswordForm, MIN_PASSWORD } from "./change-password-dialog";

// The super admin's own settings: account, password, sessions, whether
// invitation emails can be sent, and who has super admin access.

export function PlatformSettings({ name, email }: { name: string; email: string }) {
  const query = usePlatformSettings();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  async function signOutEverywhere() {
    setSigningOut(true);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: "global" });
      if (error) {
        toast.error("Couldn't sign out of every device. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your super admin account, security, and how the console sends email." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><UserIcon className="h-4 w-4" aria-hidden /> Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Name</p><p className="font-medium text-foreground">{name}</p></div>
            <div><p className="text-xs text-muted-foreground">Email (sign-in)</p><p className="font-medium text-foreground">{email}</p></div>
            <div>
              <p className="text-xs text-muted-foreground">Access</p>
              <p className="flex items-center gap-1.5 font-medium text-foreground"><ShieldCheckIcon className="h-4 w-4 text-primary" aria-hidden /> Super admin: every clinic, plans and payments</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Super admins see clinic details, usage counts and names of clinic staff, never patients&apos; medical records.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><KeyRoundIcon className="h-4 w-4" aria-hidden /> Change password</CardTitle>
            <CardDescription>At least {MIN_PASSWORD} characters. You stay signed in on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm idPrefix="settings" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><LogOutIcon className="h-4 w-4" aria-hidden /> Signed-in devices</CardTitle>
            <CardDescription>If you signed in on a shared or lost computer or phone, sign out everywhere. You&apos;ll need your password to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setConfirmOut(true)} disabled={signingOut}>Sign out of all devices</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MailIcon className="h-4 w-4" aria-hidden /> Invitation emails</CardTitle>
            <CardDescription>New clinic administrators get an email to set their password.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {query.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : query.data?.emailConfigured ? (
              <p className="flex items-start gap-2 text-success">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This server can send invitation emails.
              </p>
            ) : query.data ? (
              <div className="space-y-2">
                <p className="flex items-start gap-2 text-danger">
                  <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This server can&apos;t send invitation emails, so new administrators won&apos;t get one.
                </p>
                <p className="text-xs text-muted-foreground">Set SUPABASE_SECRET_KEY in the server&apos;s environment variables (on Vercel: Settings → Environment Variables), then redeploy.</p>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Supabase&apos;s built-in email service sends only a few emails an hour. For real clinics, set up your own email provider in Supabase → Authentication → SMTP Settings.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheckIcon className="h-4 w-4" aria-hidden /> Who has super admin access</CardTitle>
          <CardDescription>Super admins can see every clinic and change plans and payments. Access is granted only by the server command `npm run auth:platform-admin`, never from this page.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : query.error ? (
            <QueryError error={query.error} what="Super admins" onRetry={() => query.refetch()} />
          ) : (
            <ul className="divide-y">
              {query.data?.admins.map((a) => (
                <li key={a.userId} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.name} {a.isYou && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</p>
                    <p className="text-xs text-muted-foreground">{a.email} · since {formatDate(a.since)}</p>
                  </div>
                  {a.status === "disabled" ? (
                    <Badge variant="outline" className="border-danger/40 text-danger">Disabled</Badge>
                  ) : a.signedIn ? (
                    <Badge variant="outline" className="border-success/40 text-success">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-warning/40 text-warning">Not signed in yet</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Sign out of all devices?"
        description="You'll be signed out here and on every other device, and need your password to sign in again."
        confirmLabel="Sign out everywhere"
        isLoading={signingOut}
        onConfirm={signOutEverywhere}
      />
    </div>
  );
}

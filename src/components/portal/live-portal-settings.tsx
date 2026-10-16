"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2Icon, HeartPulseIcon, KeyRoundIcon, Loader2Icon, LogOutIcon, MailIcon, MonitorSmartphoneIcon, PhoneIcon, ShieldCheckIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePortalClinic, usePortalRecord } from "@/hooks/use-portal";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuthStore } from "@/store/auth-store";

// Account settings for a signed-in patient: who they're signed in as, their
// clinic record at a glance (changes go through the clinic), password, signing
// out (this device or all others) and how to reach the clinic. The password
// goes straight to Supabase Auth; the app never sees or stores it.

const MIN_PASSWORD = 12;

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words text-sm font-medium text-foreground">{value || "—"}</p>
      </div>
    </div>
  );
}

export function LivePortalSettings() {
  const user = useCurrentUser();
  const record = usePortalRecord();
  const clinic = usePortalClinic();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Account settings</h1>
        <p className="text-sm text-muted-foreground">Your sign-in, security and how to reach your clinic.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>The email you sign in with.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Row icon={UserIcon} label="Name" value={user?.name} />
            <Row icon={MailIcon} label="Sign-in email" value={user?.email} />
            {record.isLoading ? (
              <Skeleton className="my-2 h-10 w-full" />
            ) : record.data ? (
              <>
                <Row icon={HeartPulseIcon} label="Patient number" value={record.data.patientNumber} />
                <Row icon={PhoneIcon} label="Phone on your clinic record" value={record.data.phone} />
              </>
            ) : null}
            <p className="pt-3 text-xs text-muted-foreground">
              To change your personal or medical details, update your <Link href="/portal/profile" className="text-primary hover:underline">Health profile</Link>. Your
              name, phone and email on the clinic record are corrected by the front desk.
            </p>
          </CardContent>
        </Card>

        <ChangePasswordCard />

        <SessionsCard />

        <Card>
          <CardHeader>
            <CardTitle>Contact your clinic</CardTitle>
            <CardDescription>For appointments, bills or changes to your record.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {clinic.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : clinic.data ? (
              <>
                <Row icon={Building2Icon} label="Clinic" value={clinic.data.name} />
                <Row icon={PhoneIcon} label="Phone" value={<a href={`tel:${clinic.data.phone.replace(/\s+/g, "")}`} className="text-primary hover:underline">{clinic.data.phone}</a>} />
                <Row icon={MailIcon} label="Email" value={<a href={`mailto:${clinic.data.email}`} className="text-primary hover:underline">{clinic.data.email}</a>} />
                <Row icon={Building2Icon} label="Address" value={`${clinic.data.addressLine}, ${clinic.data.city}, ${clinic.data.state} ${clinic.data.pincode}`} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Couldn&apos;t load your clinic&apos;s details.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.code === "weak_password"
            ? "That password is too weak. Try a longer one."
            : updateError.code === "same_password"
              ? "That's your current password. Choose a new one."
              : updateError.code === "reauthentication_needed" || updateError.status === 401
                ? "For your security, sign out and sign in again, then change your password."
                : "Couldn't change your password. Please try again."
        );
        return;
      }
      setPassword("");
      setConfirm("");
      toast.success("Password changed.");
    } catch {
      setError("Couldn't reach the sign-in service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="h-4 w-4" aria-hidden /> Change password</CardTitle>
        <CardDescription>At least {MIN_PASSWORD} characters. You stay signed in on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={saving || !password || !confirm}>
            {saving && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signOutHere() {
    setBusy(true);
    logout();
    await fetch("/auth/signout", { method: "POST" }).catch(() => undefined);
    router.replace("/login?reason=signed_out");
    router.refresh();
  }

  async function signOutOthers() {
    setBusy(true);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Signed out on every other device.");
    } catch {
      toast.error("Couldn't sign out other devices. Please try again.");
    } finally {
      setBusy(false);
      setConfirmOthers(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheckIcon className="h-4 w-4" aria-hidden /> Sign-in & security</CardTitle>
        <CardDescription>Lost a phone or used a shared computer? Sign out everywhere else.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="outline" onClick={() => setConfirmOthers(true)} disabled={busy}><MonitorSmartphoneIcon /> Sign out other devices</Button>
        <Button variant="outline" onClick={signOutHere} disabled={busy}><LogOutIcon /> Sign out</Button>
      </CardContent>
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out on all other devices?"
        description="You stay signed in here. Everywhere else you'll need to sign in again."
        confirmLabel="Sign out others"
        isLoading={busy}
        onConfirm={signOutOthers}
      />
    </Card>
  );
}

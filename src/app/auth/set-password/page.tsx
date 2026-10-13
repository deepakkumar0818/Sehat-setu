"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const MIN_LENGTH = 12;

/**
 * Where an invited user (or a password-reset link) lands after /auth/confirm
 * has exchanged the email token for a session. The password goes straight to
 * Supabase Auth — the app never sees or stores it.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.code === "weak_password"
            ? "That password is too weak. Try a longer one."
            : updateError.status === 401 || updateError.code === "session_not_found"
              ? "Your invitation link has expired. Ask your administrator to send a new one."
              : "Couldn't save your password. Please try again."
        );
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Couldn't reach the sign-in service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!isSupabaseAuthEnabled()) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        Sign-in isn&apos;t configured on this server.
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo size="md" />
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">Set your password</h1>
          <p className="text-sm text-muted-foreground">Choose a password to finish setting up your Sehat Setu account.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Save password
          </Button>
        </form>
      </div>
    </div>
  );
}

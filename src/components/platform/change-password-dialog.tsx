"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const MIN_PASSWORD = 12;

/** The signed-in person's own password. Goes straight to Supabase Auth; the app never sees it. */
export function ChangePasswordForm({ onDone, onCancel, idPrefix = "pa" }: { onDone?: () => void; onCancel?: () => void; idPrefix?: string }) {
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
      toast.success("Password changed. Use the new one next time you sign in.");
      setPassword("");
      setConfirm("");
      onDone?.();
    } catch {
      setError("Couldn't reach the sign-in service. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-new-password`}>New password</Label>
        <Input id={`${idPrefix}-new-password`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-confirm-password`}>Confirm new password</Label>
        <Input id={`${idPrefix}-confirm-password`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={saving || !password || !confirm}>
          {saving && <Loader2Icon className="animate-spin" />}
          Change password
        </Button>
      </div>
    </form>
  );
}

/** Top-bar shortcut: the same form in a dialog. */
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <KeyRoundIcon /> <span className="hidden sm:inline">Change password</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>At least {MIN_PASSWORD} characters. You stay signed in on this device.</DialogDescription>
          </DialogHeader>
          {open && <ChangePasswordForm idPrefix="dlg" onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

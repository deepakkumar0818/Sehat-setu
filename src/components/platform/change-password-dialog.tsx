"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiRequestError } from "@/lib/api-client";
import { liveApi } from "@/lib/live-api";
import { PASSWORD_MIN, newPasswordProblem, passwordStrength } from "@/lib/password-rules";
import { cn } from "@/lib/utils";

export const MIN_PASSWORD = PASSWORD_MIN;

function PasswordInput({ id, label, value, onChange, autoComplete, autoFocus, invalid }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className="pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {shown ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

const STRENGTH = [
  { label: "", bar: "" },
  { label: "Weak", bar: "bg-danger" },
  { label: "Fair", bar: "bg-warning" },
  { label: "Good", bar: "bg-success" },
  { label: "Strong", bar: "bg-success" },
] as const;

/**
 * Change your own password: current password first, then the new one twice.
 * The server checks the current password before saving, and signs out your
 * other devices. Passwords go only to this app's server and Supabase Auth.
 */
export function ChangePasswordForm({ email, onDone, onCancel, idPrefix = "pa" }: { email?: string; onDone?: () => void; onCancel?: () => void; idPrefix?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [saving, setSaving] = useState(false);

  const problem = next ? newPasswordProblem(next, { current: current || undefined, email }) : null;
  const strength = passwordStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length > 0 && !problem && confirm === next;
  const rules = [
    { ok: next.length >= PASSWORD_MIN, text: `At least ${PASSWORD_MIN} characters` },
    { ok: next.length > 0 && next !== current, text: "Different from your current password" },
    { ok: next.length > 0 && !problem, text: "Not easy to guess (no common words or your email)" },
  ];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !ready) return;
    setError(null);
    setWrongCurrent(false);
    setSaving(true);
    try {
      const r = await liveApi.account.changePassword({ currentPassword: current, newPassword: next });
      toast.success(r.otherSessionsSignedOut ? "Password changed. You've been signed out on your other devices." : "Password changed.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone?.();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Couldn't reach the server. Please try again.";
      if (/current password is incorrect/i.test(message)) setWrongCurrent(true);
      setError(err instanceof ApiRequestError && err.status === 401 ? "Your session has ended. Sign in again, then change your password." : message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Lets password managers attach the change to the right account. */}
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <PasswordInput id={`${idPrefix}-current`} label="Current password" value={current} onChange={(v) => { setCurrent(v); setWrongCurrent(false); }} autoComplete="current-password" invalid={wrongCurrent} />
      <div className="space-y-2">
        <PasswordInput id={`${idPrefix}-new`} label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        {next && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 gap-1" aria-hidden>
                {[1, 2, 3, 4].map((i) => <div key={i} className={cn("h-1 flex-1 rounded-full bg-muted", strength >= i && STRENGTH[strength].bar)} />)}
              </div>
              <span className="w-12 text-right text-xs text-muted-foreground">{STRENGTH[strength].label}</span>
            </div>
            <ul className="space-y-0.5 text-xs">
              {rules.map((r) => (
                <li key={r.text} className={cn("flex items-center gap-1.5", r.ok ? "text-success" : "text-muted-foreground")}>
                  {r.ok ? <CheckIcon className="h-3 w-3" aria-hidden /> : <XIcon className="h-3 w-3" aria-hidden />} {r.text}
                </li>
              ))}
            </ul>
            {problem && next.length >= PASSWORD_MIN && <p className="text-xs text-danger">{problem}</p>}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <PasswordInput id={`${idPrefix}-confirm`} label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={mismatch} />
        {mismatch && <p className="text-xs text-danger">The passwords don&apos;t match.</p>}
      </div>
      {error && <p role="alert" className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted-foreground">After the change, you&apos;re signed out on every other device. Forgot your current password? Sign out and use &quot;Forgot password?&quot; on the sign-in page.</p>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={saving || !ready}>
          {saving && <Loader2Icon className="animate-spin" />}
          {saving ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}

/** Top-bar shortcut: the same form in a dialog. */
export function ChangePasswordButton({ email }: { email?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <KeyRoundIcon /> <span className="hidden sm:inline">Change password</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Enter your current password, then choose a new one.</DialogDescription>
          </DialogHeader>
          {open && <ChangePasswordForm email={email} idPrefix="dlg" onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

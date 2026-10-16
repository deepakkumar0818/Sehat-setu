"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requestPasswordResetAction } from "./actions";

/** The same message whether or not an account exists (no account enumeration). */
export const RESET_SENT_MESSAGE = "If an account exists for that email, we've sent a link to reset your password. It may take a few minutes to arrive; check your spam folder too.";

export function ForgotPassword({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-primary hover:underline">
        Forgot password?
      </button>
      {open && <ForgotPasswordDialog defaultEmail={defaultEmail} onClose={() => setOpen(false)} />}
    </>
  );
}

function ForgotPasswordDialog({ defaultEmail, onClose }: { defaultEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // the dialog is portalled, but React would still bubble this submit to the sign-in form
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setState("sending");
    const result = await requestPasswordResetAction({ email }).catch(() => ({ ok: false as const, error: "unavailable" as const }));
    if (result.ok) return setState("sent");
    setState("error");
    setError(result.error === "invalid_input" ? "Enter a valid email address." : "Couldn't reach the sign-in service. Please try again.");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && state !== "sending" && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>Enter the email you sign in with. We&apos;ll email you a link to choose a new password.</DialogDescription>
        </DialogHeader>
        {state === "sent" ? (
          <p role="status" className="text-sm text-foreground">{RESET_SENT_MESSAGE}</p>
        ) : (
          <form id="forgot-password" onSubmit={submit} className="space-y-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={state === "sending"} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </form>
        )}
        <DialogFooter>
          {state === "sent" ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={state === "sending"}>Cancel</Button>
              <Button type="submit" form="forgot-password" disabled={state === "sending"}>
                {state === "sending" && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Send reset link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

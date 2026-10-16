"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendEmailOtpAction, verifyEmailOtpAction } from "./actions";

const ERRORS: Record<string, string> = {
  invalid_input: "Enter the code from the email.",
  invalid_code: "That code is wrong or has expired. Check it, or send a new code.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  not_configured: "Sign-in isn't configured on this server.",
  unavailable: "Couldn't reach the sign-in service. Please try again.",
};

/**
 * The sign-up code step, shared by /register (right after signing up) and
 * /login (a password sign-in refused because the email isn't confirmed yet).
 * Only a correct code confirms the email; then /link-account continues.
 */
export function VerifyEmailCode({ email, notice, onBack, backLabel }: { email: string; notice: string; onBack?: () => void; backLabel?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(notice);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6,10}$/.test(code.trim())) return setError(ERRORS.invalid_input);
    setBusy(true);
    const result = await verifyEmailOtpAction({ email, token: code }).catch(() => ({ ok: false as const, error: "unavailable" as const }));
    if (result.ok) {
      // Signed in now: /link-account connects (code) or creates (new patient) the record.
      router.replace("/link-account");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(ERRORS[result.error] ?? ERRORS.unavailable);
  }

  async function resend() {
    setError(null);
    setBusy(true);
    const result = await resendEmailOtpAction({ email }).catch(() => ({ ok: false }));
    setBusy(false);
    if (!result.ok) return setError(ERRORS.rate_limited);
    setStatus("If this address is waiting for a code, we've sent a new one.");
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2 text-center">
        <MailCheckIcon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold text-foreground">Verify your email</h1>
        <p role="status" className="text-sm text-muted-foreground">
          {status} <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder="123456"
            className="text-center font-mono text-lg tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Verify and continue
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        {onBack ? (
          <button type="button" className="text-muted-foreground hover:underline" onClick={onBack} disabled={busy}>
            {backLabel ?? "Back"}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="font-medium text-primary hover:underline" onClick={resend} disabled={busy}>
          Send a new code
        </button>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Already verified this email?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>{" "}
        — we&apos;ll finish setting up your account.
      </p>
    </div>
  );
}

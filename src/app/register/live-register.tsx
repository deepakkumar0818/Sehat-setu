"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/shared/logo";
import { signUpAction } from "./actions";
import { VerifyEmailCode } from "./verify-email-code";

const MIN_LENGTH = 12;

/** The same message whether or not the address already had a login (no account enumeration). */
export const SIGN_UP_SENT_MESSAGE = "If this address can be registered, we've emailed a verification code to";

const ERRORS: Record<string, string> = {
  invalid_input: "Check your details: a valid email address and a password of at least 12 characters.",
  weak_password: "That password is too weak. Try a longer one.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  closed: "New registrations are closed right now. Please ask your clinic for help.",
  not_configured: "Sign-in isn't configured on this server.",
  unavailable: "Couldn't reach the sign-in service. Please try again.",
};

type Gender = "male" | "female" | "other";

/**
 * Patient self-registration (live mode): the patient's details and a login,
 * then the emailed one-time code. Registering shows no clinic data until
 * /link-account links an existing record (clinic code) or creates a new one.
 */
export function LiveRegister() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "otp">("details");
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\+?[0-9][0-9 ()-]{4,29}$/.test(phone.trim())) return setError("Enter a valid phone number.");
    if (!dateOfBirth || dateOfBirth > today || dateOfBirth < "1900-01-01") return setError("Enter a valid date of birth.");
    if (!gender) return setError("Choose a gender.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < MIN_LENGTH) return setError(`Use a password of at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const result = await signUpAction({ name, phone, dateOfBirth, gender, email, password }).catch(() => ({ ok: false as const, error: "unavailable" as const }));
    setBusy(false);
    if (!result.ok) return setError(ERRORS[result.error] ?? ERRORS.unavailable);
    setPassword("");
    setConfirm("");
    setStep("otp");
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo size="md" />
        </div>
        {step === "otp" ? (
          <VerifyEmailCode email={email.trim().toLowerCase()} notice={SIGN_UP_SENT_MESSAGE} onBack={() => { setStep("details"); setError(null); }} backLabel="Change details" />
        ) : (
          <>
            <div className="space-y-2 text-center">
              <h1 className="text-xl font-semibold text-foreground">Create your patient account</h1>
              <p className="text-sm text-muted-foreground">
                We&apos;ll email you a code to confirm your address. Already a patient at the clinic? After confirming, enter the linking code the front desk gives you.
              </p>
            </div>
            <form onSubmit={submitDetails} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dob">Date of birth</Label>
                  <Input id="dob" type="date" autoComplete="bday" min="1900-01-01" max={today} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gender">Gender</Label>
                  <Select value={gender} onValueChange={(v) => setGender(v as Gender)} disabled={busy}>
                    <SelectTrigger id="gender" className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Create account
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Already registered?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

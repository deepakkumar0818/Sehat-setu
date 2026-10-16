"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { completeRegistrationAction } from "./actions";

type Gender = "male" | "female" | "other";

/** The patient's details, for a confirmed login that doesn't have them yet. */
export function CompleteRegistrationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\+?[0-9][0-9 ()-]{4,29}$/.test(phone.trim())) return setError("Enter a valid phone number.");
    if (!dateOfBirth || dateOfBirth > today || dateOfBirth < "1900-01-01") return setError("Enter a valid date of birth.");
    if (!gender) return setError("Choose a gender.");
    setBusy(true);
    const result = await completeRegistrationAction({ name, phone, dateOfBirth, gender }).catch(() => ({ ok: false as const, message: "Couldn't set up your account right now. Please try again." }));
    if (result.ok) {
      router.replace("/portal");
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-left">
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
        Continue
      </Button>
    </form>
  );
}

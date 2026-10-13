"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LockIcon, UserPlusIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDataStore } from "@/store/data-store";
import { useAuthStore } from "@/store/auth-store";
import { useRegisterPatient } from "@/hooks/use-patients";
import type { Gender } from "@/types";

interface BookingAuthStepProps {
  name: string;
  phone: string;
  email: string;
  onAuthenticated: (patientId: string) => void;
}

export function BookingAuthStep({ name, phone, email, onAuthenticated }: BookingAuthStepProps) {
  const existingPatient = useDataStore((s) => s.db.patients.find((p) => p.email.toLowerCase() === email.toLowerCase()));
  const login = useAuthStore((s) => s.login);
  const registerPatient = useRegisterPatient();

  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    setError(null);
    const ok = login(email, password);
    if (!ok) {
      setError("Incorrect password. Please try again.");
      return;
    }
    onAuthenticated(existingPatient!.id);
  };

  const handleRegister = () => {
    setError(null);
    if (!dob) {
      setError("Enter your date of birth.");
      return;
    }
    if (password.length < 4) {
      setError("Choose a password with at least 4 characters.");
      return;
    }
    registerPatient.mutate(
      { name, phone, email, dob, gender, password },
      {
        onSuccess: (patient) => {
          const ok = login(email, password);
          if (ok) {
            toast.success("Account created.");
            onAuthenticated(patient.id);
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Could not create your account."),
      }
    );
  };

  if (existingPatient) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-foreground">Sign in to confirm</h2>
        <p className="mt-1 text-sm text-muted-foreground">An account with {email} already exists. Sign in to continue booking.</p>
        <div className="mt-4 max-w-sm space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="signin-password">Password</Label>
            <Input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button size="lg" className="w-full" onClick={handleSignIn} disabled={!password}>
            <LockIcon /> Sign in &amp; continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Create your account</h2>
      <p className="mt-1 text-sm text-muted-foreground">Just two more details — this becomes your Sehat Setu patient account.</p>
      <div className="mt-4 grid max-w-md grid-cols-2 gap-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="register-dob">Date of birth</Label>
          <Input id="register-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="register-password">Create a password</Label>
          <Input id="register-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={handleRegister} disabled={registerPatient.isPending}>
        <UserPlusIcon /> {registerPatient.isPending ? "Creating account…" : "Create account & continue"}
      </Button>
    </div>
  );
}

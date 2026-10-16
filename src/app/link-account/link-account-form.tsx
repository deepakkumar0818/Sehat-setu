"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redeemLinkCodeAction } from "./actions";

/**
 * P6.4: the one-time code the clinic's front desk gave the patient (after
 * checking their identity). Only the code is sent; the server finds the
 * patient and clinic from it. Held in this field only — never stored or logged.
 */
export function LinkAccountForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) return setError("Enter the linking code from your clinic.");
    setBusy(true);
    const result = await redeemLinkCodeAction({ code }).catch(() => ({ ok: false as const, message: "Couldn't link your account right now. Please try again." }));
    if (result.ok) {
      setCode("");
      router.replace("/portal");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="link-code">Linking code</Label>
        <Input
          id="link-code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="font-mono tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={busy}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
        Link my record
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { CreditCardIcon, LandmarkIcon, LoaderIcon, QrCodeIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { PaymentMethod } from "@/types";

interface BookingPaymentStepProps {
  amount: number;
  isProcessing: boolean;
  onPay: (method: PaymentMethod) => void;
}

const METHODS: { value: PaymentMethod; label: string; icon: typeof CreditCardIcon }[] = [
  { value: "upi", label: "UPI", icon: QrCodeIcon },
  { value: "card", label: "Card", icon: CreditCardIcon },
  { value: "bank_transfer", label: "Net Banking", icon: LandmarkIcon },
];

export function BookingPaymentStep({ amount, isProcessing, onPay }: BookingPaymentStepProps) {
  const [method, setMethod] = useState<PaymentMethod>("upi");

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Payment</h2>
      <p className="mt-1 text-sm text-muted-foreground">This is a simulated demo payment — no real transaction is made.</p>

      <div className="mt-4 grid max-w-md grid-cols-3 gap-2">
        {METHODS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setMethod(value)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors",
              method === value ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 max-w-md rounded-lg border bg-muted/30 p-4">
        {method === "upi" && (
          <div className="space-y-1.5">
            <Label htmlFor="upi-id">UPI ID</Label>
            <Input id="upi-id" placeholder="yourname@upi" defaultValue="demo@upi" />
          </div>
        )}
        {method === "card" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="card-number">Card number</Label>
              <Input id="card-number" placeholder="4242 4242 4242 4242" defaultValue="4242 4242 4242 4242" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-expiry">Expiry</Label>
              <Input id="card-expiry" placeholder="MM/YY" defaultValue="12/28" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-cvv">CVV</Label>
              <Input id="card-cvv" placeholder="•••" type="password" defaultValue="123" />
            </div>
          </div>
        )}
        {method === "bank_transfer" && (
          <div className="space-y-1.5">
            <Label htmlFor="bank-select">Select bank</Label>
            <Input id="bank-select" defaultValue="Demo National Bank" />
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="h-3.5 w-3.5" /> No real payment details are processed in this demo environment.
      </p>

      <div className="mt-5 flex items-center justify-between rounded-lg border bg-card p-4 max-w-md">
        <span className="text-sm font-medium text-foreground">Amount payable</span>
        <span className="text-lg font-semibold text-foreground">{formatCurrency(amount)}</span>
      </div>

      <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={() => onPay(method)} disabled={isProcessing}>
        {isProcessing ? <LoaderIcon className="animate-spin" /> : null}
        {isProcessing ? "Processing payment…" : `Pay ${formatCurrency(amount)}`}
      </Button>
    </div>
  );
}

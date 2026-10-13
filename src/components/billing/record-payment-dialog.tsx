"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordPayment } from "@/hooks/use-billing";
import { formatCurrency } from "@/lib/format";
import type { Invoice, PaymentMethod } from "@/types";

export function RecordPaymentDialog({ open, onOpenChange, invoice }: { open: boolean; onOpenChange: (open: boolean) => void; invoice: Invoice }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The form mounts each time the dialog opens, so it starts from the current balance. */}
      <DialogContent className="sm:max-w-sm">{open && <PaymentForm invoice={invoice} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function PaymentForm({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const recordPayment = useRecordPayment();

  // A quick check for the form; the server validates the amount against the balance under a lock.
  const handleSave = () => {
    if (amount <= 0 || amount > invoice.balance) return;
    recordPayment.mutate(
      { invoiceId: invoice.id, amount, method, reference: reference.trim() || undefined },
      { onSuccess: () => { toast.success("Payment recorded."); onDone(); } }
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Collect payment</DialogTitle>
        <DialogDescription>Balance due: {formatCurrency(invoice.balance)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="payment-amount">Amount (₹)</Label>
          <Input id="payment-amount" type="number" min={1} max={invoice.balance} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>Payment method</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              <SelectItem value="online">Online</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payment-reference">Reference (optional)</Label>
          <Input id="payment-reference" maxLength={100} placeholder="UPI / card / transfer reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Record money already received. No payment is taken through the app.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={recordPayment.isPending || amount <= 0 || amount > invoice.balance}>
          {recordPayment.isPending ? "Saving…" : "Record payment"}
        </Button>
      </DialogFooter>
    </>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateExpense } from "@/hooks/use-billing";
import { useDataStore } from "@/store/data-store";
import { todayDateStr } from "@/lib/demo-clock";
import type { ExpenseCategory } from "@/types";

const CATEGORIES: ExpenseCategory[] = ["rent", "salary", "utilities", "equipment", "medicine_purchase", "lab_expense", "marketing", "maintenance", "other"];

export function ExpenseFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const branches = useDataStore((s) => s.db.branches);
  const createExpense = useCreateExpense();
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [paidTo, setPaidTo] = useState("");

  const handleSave = () => {
    if (!description || amount <= 0 || !branchId) return;
    createExpense.mutate(
      { category, branchId, description, amount, date: todayDateStr(), paidTo: paidTo || undefined },
      {
        onSuccess: () => {
          toast.success("Expense recorded.");
          onOpenChange(false);
          setDescription("");
          setAmount(0);
          setPaidTo("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>Record a clinic expense.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Monthly clinic rent" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-amount">Amount (₹)</Label>
            <Input id="exp-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-paidto">Paid to (optional)</Label>
            <Input id="exp-paidto" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createExpense.isPending || !description || amount <= 0}>
            {createExpense.isPending ? "Saving…" : "Add expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAdjustStock } from "@/hooks/use-inventory";
import type { MedicineWithStatus } from "@/services/inventory";

export function AdjustStockDialog({ open, onOpenChange, medicine }: { open: boolean; onOpenChange: (open: boolean) => void; medicine: MedicineWithStatus | null }) {
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [quantity, setQuantity] = useState(10);
  const adjustStock = useAdjustStock();

  if (!medicine) return null;

  const handleSave = () => {
    const delta = direction === "add" ? quantity : -quantity;
    adjustStock.mutate(
      { id: medicine.id, delta, reference: direction === "add" ? "Manual restock" : "Manual adjustment" },
      { onSuccess: () => { toast.success("Stock updated."); onOpenChange(false); } }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust stock — {medicine.name}</DialogTitle>
          <DialogDescription>Current stock: {medicine.stock} {medicine.unit}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={direction} onValueChange={(v) => setDirection(v as "add" | "remove")} className="flex gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="add" id="dir-add" />
            <Label htmlFor="dir-add">Add stock</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="remove" id="dir-remove" />
            <Label htmlFor="dir-remove">Remove stock</Label>
          </div>
        </RadioGroup>
        <div className="space-y-1.5">
          <Label htmlFor="qty">Quantity</Label>
          <Input id="qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={adjustStock.isPending || quantity <= 0}>{adjustStock.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

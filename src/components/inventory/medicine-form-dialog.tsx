"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateMedicine } from "@/hooks/use-inventory";

const medicineSchema = z.object({
  name: z.string().min(2, "Enter a medicine name"),
  category: z.string().min(2, "Enter a category"),
  batchNumber: z.string().min(1, "Enter a batch number"),
  stock: z.coerce.number().int().min(0),
  unit: z.string().min(1, "Enter a unit"),
  reorderLevel: z.coerce.number().int().min(1),
  expiryDate: z.string().min(1, "Select an expiry date"),
  supplier: z.string().min(2, "Enter a supplier"),
  pricePerUnit: z.coerce.number().min(0),
});

type MedicineFormValues = z.infer<typeof medicineSchema>;

export function MedicineFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createMedicine = useCreateMedicine();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<MedicineFormValues>({
    resolver: zodResolver(medicineSchema),
    defaultValues: { unit: "strips", stock: 0, reorderLevel: 20, pricePerUnit: 0 },
  });

  useEffect(() => {
    if (open) reset({ unit: "strips", stock: 0, reorderLevel: 20, pricePerUnit: 0 });
  }, [open, reset]);

  const onSubmit = (values: MedicineFormValues) => {
    createMedicine.mutate(values, {
      onSuccess: () => {
        toast.success("Medicine added to inventory.");
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add medicine</DialogTitle>
          <DialogDescription>Add a new medicine batch to your pharmacy inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="med-name">Medicine name</Label>
            <Input id="med-name" placeholder="e.g. Paracetamol" {...register("name")} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-category">Category</Label>
            <Input id="med-category" placeholder="e.g. Analgesic" {...register("category")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-batch">Batch number</Label>
            <Input id="med-batch" placeholder="e.g. B2026045" {...register("batchNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-stock">Initial stock</Label>
            <Input id="med-stock" type="number" min={0} {...register("stock")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-unit">Unit</Label>
            <Input id="med-unit" placeholder="strips / bottles / units" {...register("unit")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-reorder">Reorder level</Label>
            <Input id="med-reorder" type="number" min={1} {...register("reorderLevel")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-expiry">Expiry date</Label>
            <Input id="med-expiry" type="date" {...register("expiryDate")} />
            {errors.expiryDate && <p className="text-xs text-danger">{errors.expiryDate.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-supplier">Supplier</Label>
            <Input id="med-supplier" placeholder="Supplier name" {...register("supplier")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="med-price">Price per unit (₹)</Label>
            <Input id="med-price" type="number" min={0} {...register("pricePerUnit")} />
          </div>
          <DialogFooter className="col-span-2 mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMedicine.isPending}>{createMedicine.isPending ? "Saving…" : "Add medicine"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

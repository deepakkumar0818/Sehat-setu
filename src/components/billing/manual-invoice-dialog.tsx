"use client";

import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { useCreateManualInvoice } from "@/hooks/use-billing";
import { useClinicSettings } from "@/hooks/use-clinic-admin";
import { useDataStore } from "@/store/data-store";
import { useLiveData } from "@/lib/data-source";
import { formatCurrency } from "@/lib/format";
import type { InvoiceCategory } from "@/types";

const CATEGORIES: { value: InvoiceCategory; label: string }[] = [
  { value: "consultation", label: "Consultation" },
  { value: "medicine", label: "Medicine" },
  { value: "lab_test", label: "Lab test" },
  { value: "procedure", label: "Procedure" },
  { value: "other", label: "Other" },
];

const invoiceSchema = z.object({
  items: z
    .array(
      z.object({
        description: z.string().min(1, "Required"),
        category: z.enum(["consultation", "medicine", "lab_test", "procedure", "other"]),
        quantity: z.coerce.number().min(1),
        unitPrice: z.coerce.number().min(0),
      })
    )
    .min(1),
  discount: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(28),
});

type InvoiceFormValues = z.infer<typeof invoiceSchema>;

interface ManualInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId?: string;
  branchId?: string;
  onCreated?: (invoiceId: string) => void;
}

export function ManualInvoiceDialog({ open, onOpenChange, patientId, branchId, onCreated }: ManualInvoiceDialogProps) {
  const live = useLiveData();
  const patients = useDataStore((s) => s.db.patients);
  const createInvoice = useCreateManualInvoice();
  // The clinic's default tax rate (Settings → Billing); staff can change it on each bill.
  const defaultTax = useClinicSettings({ enabled: live }).data?.settings.defaultTaxPercent ?? 0;
  const [selectedPatientId, setSelectedPatientId] = useState(patientId ?? "");
  const needsPatientPicker = !patientId;
  const { register, control, handleSubmit, watch, reset, formState: { errors } } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      items: [{ description: "Consultation fee", category: "consultation", quantity: 1, unitPrice: 500 }],
      discount: 0,
      taxRate: 0,
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const values = watch();

  useEffect(() => {
    if (open) {
      reset({ items: [{ description: "Consultation fee", category: "consultation", quantity: 1, unitPrice: 500 }], discount: 0, taxRate: defaultTax });
      setSelectedPatientId(patientId ?? "");
    }
  }, [open, patientId, reset, defaultTax]);

  const subtotal = values.items?.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0) ?? 0;
  // Preview only, using the same rule as the server (tax on the discounted amount); the server recomputes every total.
  const discount = Number(values.discount) || 0;
  const discountTooLarge = discount > subtotal;
  const tax = Math.round(Math.max(0, subtotal - discount) * ((Number(values.taxRate) || 0) / 100));
  const total = Math.max(0, subtotal - discount + tax);

  const onSubmit = (data: InvoiceFormValues) => {
    // Live: the server picks the user's or the patient's branch when none is given.
    const resolvedBranchId = branchId ?? (live ? "" : patients.find((p) => p.id === selectedPatientId)?.branchId);
    if (!selectedPatientId || (!live && !resolvedBranchId) || discountTooLarge) return;
    createInvoice.mutate(
      {
        patientId: selectedPatientId,
        branchId: resolvedBranchId ?? "",
        discount: data.discount,
        taxRate: data.taxRate,
        items: data.items.map((i) => ({ ...i, amount: i.quantity * i.unitPrice })),
      },
      {
        onSuccess: (invoice) => {
          toast.success(`Invoice ${invoice.invoiceNumber ?? invoice.id} created.`);
          onOpenChange(false);
          onCreated?.(invoice.id);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>Add line items for consultation, medicines, lab tests, or procedures.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {needsPatientPicker && (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientCombobox value={selectedPatientId} onChange={setSelectedPatientId} />
            </div>
          )}
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 items-start gap-2">
                <div className="col-span-5">
                  <Input placeholder="Description" {...register(`items.${index}.description`)} />
                </div>
                <div className="col-span-3">
                  <Controller
                    control={control}
                    name={`items.${index}.category`}
                    render={({ field: categoryField }) => (
                      <Select value={categoryField.value} onValueChange={categoryField.onChange}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="col-span-2">
                  <Input type="number" min={1} placeholder="Qty" {...register(`items.${index}.quantity`)} />
                </div>
                <div className="col-span-1">
                  <Input type="number" min={0} placeholder="₹" {...register(`items.${index}.unitPrice`)} />
                </div>
                <div className="col-span-1 flex h-9 items-center">
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2Icon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {errors.items && <p className="text-xs text-danger">Add at least one valid line item.</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => append({ description: "", category: "other", quantity: 1, unitPrice: 0 })}>
              <PlusIcon /> Add line item
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="discount">Discount (₹)</Label>
              <Input id="discount" type="number" min={0} {...register("discount")} />
              {discountTooLarge && <p className="text-xs text-danger">The discount can&apos;t exceed the subtotal.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxRate">Tax (%)</Label>
              <Input id="taxRate" type="number" min={0} max={28} {...register("taxRate")} />
            </div>
          </div>

          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{formatCurrency(Number(values.discount) || 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>+{formatCurrency(tax)}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createInvoice.isPending || !selectedPatientId || discountTooLarge}>{createInvoice.isPending ? "Creating…" : "Create invoice"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

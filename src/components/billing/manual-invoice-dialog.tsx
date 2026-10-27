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
import { cn } from "@/lib/utils";
import type { InvoiceCategory } from "@/types";

/** Line-item columns on wider screens: description, type, qty, price, amount, remove. */
const LINE_GRID = "sm:grid-cols-[minmax(0,1fr)_8.5rem_4.5rem_7rem_5.5rem_2.25rem]";

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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
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
            <Label>Line items</Label>
            {/* Column headings (wide screens); on phones each item is a labelled card. */}
            <div className={cn(LINE_GRID, "hidden px-1 text-xs font-medium text-muted-foreground sm:grid")}>
              <span>Description</span>
              <span>Type</span>
              <span>Qty</span>
              <span>Price (₹)</span>
              <span className="text-right">Amount</span>
              <span className="sr-only">Remove</span>
            </div>
            {fields.map((field, index) => {
              const item = values.items?.[index];
              const amount = (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0);
              const itemErrors = errors.items?.[index];
              return (
                <div key={field.id} className={cn(LINE_GRID, "grid grid-cols-2 items-start gap-2 rounded-lg border p-2 sm:rounded-none sm:border-0 sm:p-0")}>
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label htmlFor={`item-${index}-desc`} className="text-xs text-muted-foreground sm:sr-only">Description</Label>
                    <Input id={`item-${index}-desc`} placeholder="e.g. Consultation fee" aria-invalid={Boolean(itemErrors?.description)} {...register(`items.${index}.description`)} />
                  </div>
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label className="text-xs text-muted-foreground sm:sr-only">Type</Label>
                    <Controller
                      control={control}
                      name={`items.${index}.category`}
                      render={({ field: categoryField }) => (
                        <Select value={categoryField.value} onValueChange={categoryField.onChange}>
                          <SelectTrigger className="w-full" aria-label="Type"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => (
                              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`item-${index}-qty`} className="text-xs text-muted-foreground sm:sr-only">Qty</Label>
                    <Input id={`item-${index}-qty`} type="number" min={1} inputMode="numeric" className="tabular-nums" aria-invalid={Boolean(itemErrors?.quantity)} {...register(`items.${index}.quantity`)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`item-${index}-price`} className="text-xs text-muted-foreground sm:sr-only">Price (₹)</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                      <Input id={`item-${index}-price`} type="number" min={0} inputMode="decimal" className="pl-6 tabular-nums" aria-invalid={Boolean(itemErrors?.unitPrice)} {...register(`items.${index}.unitPrice`)} />
                    </div>
                  </div>
                  <div className="flex h-9 items-center justify-between gap-2 sm:justify-end">
                    <span className="text-xs text-muted-foreground sm:hidden">Amount</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(amount)}</span>
                  </div>
                  <div className="flex h-9 items-center justify-end">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} onClick={() => remove(index)} disabled={fields.length === 1}>
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {errors.items && <p className="text-xs text-danger">Each line needs a description, a quantity of at least 1 and a price.</p>}
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

          <div className="space-y-1.5 rounded-md bg-muted/50 p-3 text-sm tabular-nums">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal ({fields.length} item{fields.length === 1 ? "" : "s"})</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{formatCurrency(discount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax ({Number(values.taxRate) || 0}%)</span><span>+{formatCurrency(tax)}</span></div>
            <div className="flex justify-between border-t pt-1.5 text-base font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div>
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

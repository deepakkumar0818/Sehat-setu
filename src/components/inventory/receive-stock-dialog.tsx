"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranches } from "@/hooks/use-branches";
import { useMedicineSearch } from "@/hooks/use-clinical";
import { MedicinePicker } from "@/components/shared/medicine-picker";
import { AddCatalogMedicineDialog } from "@/components/inventory/add-catalog-medicine-dialog";
import type { CatalogMedicine } from "@/services/clinical";
import { useReceiveStock } from "@/hooks/use-inventory";
import { useTodayKey } from "@/lib/data-source";

// Clinic database: receive a delivery into a batch of a catalogue medicine.
// The server validates everything again; quantity changes only through the
// recorded receipt. Administrators can add a missing medicine to the shared
// catalogue from here (create-only; the server and database re-check).

interface ReceiveStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select (e.g. from a medicine's stock page). */
  medicine?: CatalogMedicine;
  branchId?: string;
  onReceived?: (branchId: string, medicineId: string) => void;
}

export function ReceiveStockDialog({ open, onOpenChange, medicine, branchId, onReceived }: ReceiveStockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <ReceiveForm fixedMedicine={medicine} branchId={branchId} onDone={() => onOpenChange(false)} onReceived={onReceived} />}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveForm({ fixedMedicine, branchId, onDone, onReceived }: { fixedMedicine?: CatalogMedicine; branchId?: string; onDone: () => void; onReceived?: (b: string, m: string) => void }) {
  const today = useTodayKey();
  const branches = useBranches(); // already limited to the user's branch scope
  // The first catalogue page also tells us whether this user may add medicines (UI hint only).
  const canCreate = Boolean(useMedicineSearch("", !fixedMedicine).data?.pages[0]?.canCreate);
  const receive = useReceiveStock();
  const [medicine, setMedicine] = useState<CatalogMedicine | null>(fixedMedicine ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    branchId: branchId ?? "",
    batchNumber: "",
    expiryDate: "",
    quantity: "",
    unitCost: "",
    supplierName: "",
    reference: "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  // A single-branch user (or one whose branches load after opening) gets their branch without choosing.
  const effectiveBranch = form.branchId || (branches.length === 1 ? branches[0].id : "");

  const quantity = Number(form.quantity);
  const unitCost = form.unitCost === "" ? undefined : Number(form.unitCost);
  const expired = form.expiryDate !== "" && form.expiryDate < today;
  const valid =
    medicine && effectiveBranch && form.batchNumber.trim() && form.expiryDate && !expired &&
    Number.isInteger(quantity) && quantity >= 1 && (unitCost === undefined || (Number.isFinite(unitCost) && unitCost >= 0));

  const submit = () => {
    if (!valid || !medicine) return;
    receive.mutate(
      {
        branchId: effectiveBranch,
        medicineId: medicine.id,
        batchNumber: form.batchNumber.trim(),
        expiryDate: form.expiryDate,
        quantity,
        unitCostPaise: unitCost === undefined ? undefined : Math.round(unitCost * 100),
        supplierName: form.supplierName.trim() || undefined,
        reference: form.reference.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Received ${quantity} into batch ${form.batchNumber.trim()}.`);
          onDone();
          onReceived?.(effectiveBranch, medicine.id);
        },
      }
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Receive stock</DialogTitle>
        <DialogDescription>Record a delivery into a batch. Medicines come from the shared catalogue.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Medicine</Label>
          <MedicinePicker
            value={medicine}
            onChange={setMedicine}
            disabled={Boolean(fixedMedicine)}
            footer={
              canCreate
                ? (close) => (
                    <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { close(); setAddOpen(true); }}>
                      <PlusIcon /> Add medicine to catalogue
                    </Button>
                  )
                : undefined
            }
          />
          {canCreate && !fixedMedicine && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAddOpen(true)}>
              Not in the catalogue? Add it
            </button>
          )}
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>Branch</Label>
          <Select value={effectiveBranch} onValueChange={(v) => set({ branchId: v })} disabled={Boolean(branchId) || branches.length === 1}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-batch">Batch number</Label>
          <Input id="rs-batch" maxLength={64} value={form.batchNumber} onChange={(e) => set({ batchNumber: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-expiry">Expiry date</Label>
          <Input id="rs-expiry" type="date" min={today} value={form.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
          {expired && <p className="text-xs text-danger">This batch has already expired.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-qty">Quantity received</Label>
          <Input id="rs-qty" type="number" min={1} max={100000} value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-cost">Unit cost (₹, optional)</Label>
          <Input id="rs-cost" type="number" min={0} step="0.01" value={form.unitCost} onChange={(e) => set({ unitCost: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-supplier">Supplier (optional)</Label>
          <Input id="rs-supplier" maxLength={120} value={form.supplierName} onChange={(e) => set({ supplierName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-ref">Receipt / invoice ref. (optional)</Label>
          <Input id="rs-ref" maxLength={100} value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} disabled={!valid || receive.isPending}>{receive.isPending ? "Saving…" : "Receive stock"}</Button>
      </DialogFooter>
      {/* The new (or chosen existing) medicine is pre-selected; the catalogue search refreshes on success. */}
      <AddCatalogMedicineDialog open={addOpen} onOpenChange={setAddOpen} onSelected={setMedicine} />
    </>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateLivePrescription } from "@/hooks/use-clinical";
import { MedicinePicker } from "@/components/shared/medicine-picker";
import type { CatalogMedicine } from "@/services/clinical";

// Clinic-database prescriptions: written by the consultation's assigned doctor,
// with every medicine chosen from the catalogue. The server validates
// everything again and numbers the prescription.

interface Row {
  key: number;
  medicine: CatalogMedicine | null;
  dosage: string;
  frequency: string;
  durationDays: string;
  route: string;
  instructions: string;
}

const ROUTES = ["Oral", "Topical", "Inhalation", "Sublingual", "Intramuscular", "Intravenous", "Subcutaneous", "Ophthalmic", "Otic", "Nasal", "Rectal"];

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, medicine: null, dosage: "", frequency: "", durationDays: "", route: "Oral", instructions: "" });

interface LivePrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultationId?: string;
  onCreated?: (prescriptionId: string) => void;
}

export function LivePrescriptionDialog({ open, onOpenChange, consultationId, onCreated }: LivePrescriptionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Mounted per opening, so each prescription starts from an empty form. */}
        {open && <PrescriptionForm consultationId={consultationId} onDone={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function PrescriptionForm({ consultationId, onDone, onCreated }: { consultationId?: string; onDone: () => void; onCreated?: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [notes, setNotes] = useState("");
  const create = useCreateLivePrescription();

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const duration = (r: Row) => Number(r.durationDays);
  const rowValid = (r: Row) => r.medicine && r.dosage.trim() && r.frequency.trim() && Number.isInteger(duration(r)) && duration(r) >= 1 && duration(r) <= 365;
  const valid = rows.length > 0 && rows.every(rowValid);

  if (!consultationId) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Create prescription</DialogTitle>
          <DialogDescription>Prescriptions are written from a consultation. Open the patient&apos;s consultation to prescribe.</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" onClick={onDone}>Close</Button></DialogFooter>
      </>
    );
  }

  const submit = () => {
    if (!valid) return;
    create.mutate(
      {
        consultationId,
        items: rows.map((r) => ({
          medicineId: r.medicine!.id,
          dosage: r.dosage.trim(),
          frequency: r.frequency.trim(),
          durationDays: duration(r),
          route: r.route || undefined,
          instructions: r.instructions.trim() || undefined,
        })),
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (rx) => {
          toast.success(rx.prescriptionNumber ? `Prescription ${rx.prescriptionNumber} created.` : "Prescription created.");
          onDone();
          onCreated?.(rx.id);
        },
      }
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create prescription</DialogTitle>
        <DialogDescription>Choose medicines from the clinic&apos;s catalogue and add dosage, frequency and duration.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {rows.map((r, index) => (
          <div key={r.key} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Medicine {index + 1}</p>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove medicine" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1}>
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-3">
                <MedicinePicker value={r.medicine} onChange={(m) => update(r.key, { medicine: m })} />
              </div>
              <Input placeholder="Dosage (e.g. 1 tablet)" maxLength={100} value={r.dosage} onChange={(e) => update(r.key, { dosage: e.target.value })} />
              <Input placeholder="Frequency (e.g. Twice daily)" maxLength={100} value={r.frequency} onChange={(e) => update(r.key, { frequency: e.target.value })} />
              <Input type="number" min={1} max={365} placeholder="Days" aria-label="Duration in days" value={r.durationDays} onChange={(e) => update(r.key, { durationDays: e.target.value })} />
              <Select value={r.route} onValueChange={(v) => update(r.key, { route: v })}>
                <SelectTrigger className="w-full" aria-label="Route"><SelectValue /></SelectTrigger>
                <SelectContent>{ROUTES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
              <div className="col-span-2">
                <Input placeholder="Instructions (optional)" maxLength={300} value={r.instructions} onChange={(e) => update(r.key, { instructions: e.target.value })} />
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])} disabled={rows.length >= 20}>
          <PlusIcon /> Add medicine
        </Button>
        <div className="space-y-1.5">
          <Label htmlFor="rx-notes">Notes (optional)</Label>
          <Textarea id="rx-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} disabled={!valid || create.isPending}>{create.isPending ? "Saving…" : "Create prescription"}</Button>
      </DialogFooter>
    </>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { medicineLabel } from "@/components/shared/medicine-picker";
import { useCreateCatalogMedicine } from "@/hooks/use-clinical";
import { ApiRequestError } from "@/lib/api-client";
import { DOSAGE_FORMS } from "@/lib/dosage-forms";
import type { CatalogMedicine } from "@/services/clinical";

// Adds a medicine to the SHARED catalogue (visible to every clinic). Only
// rendered for users the server says may create; the server and the database
// function check the permission again. There is no edit or delete here:
// corrections are operator-only.

interface AddCatalogMedicineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new medicine, or with an existing one the user chose to use instead. */
  onSelected: (medicine: CatalogMedicine) => void;
}

export function AddCatalogMedicineDialog({ open, onOpenChange, onSelected }: AddCatalogMedicineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <AddForm
            onDone={() => onOpenChange(false)}
            onSelected={(m) => {
              onSelected(m);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Problem =
  | { kind: "confirm"; matches: CatalogMedicine[] }
  | { kind: "duplicate"; existing?: CatalogMedicine; message: string }
  | { kind: "error"; message: string };

function AddForm({ onDone, onSelected }: { onDone: () => void; onSelected: (m: CatalogMedicine) => void }) {
  const [form, setForm] = useState({ name: "", genericName: "", strength: "", dosageForm: "" });
  const [problem, setProblem] = useState<Problem | null>(null);
  const create = useCreateCatalogMedicine();
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null); // any edit invalidates a previous warning
  };
  const valid = form.name.trim().length >= 2 && form.genericName.trim().length >= 2 && form.strength.trim().length >= 1 && form.dosageForm !== "";

  const submit = (confirmGenericMatch: boolean) => {
    create.mutate(
      { ...form, confirmGenericMatch: confirmGenericMatch || undefined },
      {
        onSuccess: (created) => {
          toast.success(`${created.name} ${created.strength} added to the shared catalogue.`);
          onSelected(created);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === "NEEDS_CONFIRMATION") {
            setProblem({ kind: "confirm", matches: (err.details as { matches?: CatalogMedicine[] } | undefined)?.matches ?? [] });
          } else if (err instanceof ApiRequestError && err.code === "DUPLICATE") {
            setProblem({ kind: "duplicate", existing: (err.details as { existing?: CatalogMedicine } | undefined)?.existing, message: err.message });
          } else {
            setProblem({ kind: "error", message: err instanceof Error ? err.message : "Couldn't add the medicine." });
          }
        },
      }
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add medicine to catalogue</DialogTitle>
        <DialogDescription>The catalogue is shared by every clinic. Check the details carefully: entries can only be corrected by an operator.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="cm-name">Medicine (brand) name</Label>
          <Input id="cm-name" maxLength={120} placeholder="e.g. Dolo 650" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="cm-generic">Generic name</Label>
          <Input id="cm-generic" maxLength={200} placeholder="e.g. Paracetamol" value={form.genericName} onChange={(e) => set({ genericName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-strength">Strength</Label>
          <Input id="cm-strength" maxLength={40} placeholder="e.g. 650 mg" value={form.strength} onChange={(e) => set({ strength: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Dosage form</Label>
          <Select value={form.dosageForm} onValueChange={(v) => set({ dosageForm: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select form" /></SelectTrigger>
            <SelectContent>{DOSAGE_FORMS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {problem?.kind === "confirm" && (
        <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangleIcon className="h-4 w-4" /> Same generic medicine already listed</p>
          <p className="mt-1 text-foreground">These entries have the same generic name, strength and form under another name:</p>
          <ul className="mt-1.5 space-y-1">
            {problem.matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>{medicineLabel(m)} <span className="text-muted-foreground">({m.genericName})</span></span>
                <Button type="button" size="sm" variant="outline" onClick={() => onSelected(m)}>Use this</Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">If this is a different brand, you can still add it.</p>
        </div>
      )}
      {problem?.kind === "duplicate" && (
        <div className="rounded-md border border-danger/30 bg-danger-muted p-3 text-sm">
          <p className="font-medium text-danger">Already in the catalogue</p>
          <p className="mt-1 text-foreground">{problem.message}</p>
          {problem.existing && (
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => onSelected(problem.existing!)}>
              Use {medicineLabel(problem.existing)}
            </Button>
          )}
        </div>
      )}
      {problem?.kind === "error" && <p className="text-sm text-danger">{problem.message}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        {problem?.kind === "confirm" ? (
          <Button onClick={() => submit(true)} disabled={create.isPending}>{create.isPending ? "Adding…" : "Add anyway"}</Button>
        ) : (
          <Button onClick={() => submit(false)} disabled={!valid || create.isPending || problem?.kind === "duplicate"}>{create.isPending ? "Adding…" : "Add medicine"}</Button>
        )}
      </DialogFooter>
    </>
  );
}

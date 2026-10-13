"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangleIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { useCreatePrescription } from "@/hooks/use-clinical";
import { useAnalyzePrescriptionSafety } from "@/hooks/use-ai";
import { useDataStore } from "@/store/data-store";
import { useLiveData } from "@/lib/data-source";
import { LivePrescriptionDialog } from "@/components/prescriptions/live-prescription-dialog";

const itemSchema = z.object({
  medicineName: z.string().min(1, "Required"),
  strength: z.string().min(1, "Required"),
  dosage: z.string().min(1, "Required"),
  frequency: z.string().min(1, "Required"),
  duration: z.string().min(1, "Required"),
  route: z.string().min(1, "Required"),
  instructions: z.string().optional(),
});

const prescriptionSchema = z.object({
  items: z.array(itemSchema).min(1),
  notes: z.string().optional(),
});

type PrescriptionFormValues = z.infer<typeof prescriptionSchema>;

const emptyItem = { medicineName: "", strength: "", dosage: "", frequency: "", duration: "", route: "Oral", instructions: "" };

interface PrescriptionBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId?: string;
  doctorId?: string;
  consultationId?: string;
  onCreated?: (prescriptionId: string) => void;
}

/** Clinic database: catalogue-based builder tied to a consultation. Demo data: the free-text builder below. */
export function PrescriptionBuilderDialog(props: PrescriptionBuilderDialogProps) {
  const live = useLiveData();
  return live ? <LivePrescriptionDialog open={props.open} onOpenChange={props.onOpenChange} consultationId={props.consultationId} onCreated={props.onCreated} /> : <DemoPrescriptionBuilderDialog {...props} />;
}

function DemoPrescriptionBuilderDialog({ open, onOpenChange, patientId, doctorId, consultationId, onCreated }: PrescriptionBuilderDialogProps) {
  const doctors = useDataStore((s) => s.db.doctors);
  const createPrescription = useCreatePrescription();
  const safetyReview = useAnalyzePrescriptionSafety();
  const [reviewFlags, setReviewFlags] = useState<string[] | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState(patientId ?? "");
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctorId ?? "");
  const needsPatientPicker = !patientId;
  const needsDoctorPicker = !doctorId;

  const { register, control, handleSubmit, watch, reset, formState: { errors } } = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionSchema),
    defaultValues: { items: [emptyItem], notes: "" },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const items = watch("items");

  useEffect(() => {
    if (open) {
      reset({ items: [emptyItem], notes: "" });
      setReviewFlags(null);
      setSelectedPatientId(patientId ?? "");
      setSelectedDoctorId(doctorId ?? "");
    }
  }, [open, patientId, doctorId, reset]);

  const runSafetyReview = () => {
    if (!selectedPatientId) return;
    safetyReview.mutate(
      { patientId: selectedPatientId, items },
      { onSuccess: (flags) => setReviewFlags(flags) }
    );
  };

  const onSubmit = (data: PrescriptionFormValues) => {
    if (!selectedPatientId || !selectedDoctorId) return;
    createPrescription.mutate(
      { patientId: selectedPatientId, doctorId: selectedDoctorId, consultationId, items: data.items, notes: data.notes },
      {
        onSuccess: (rx) => {
          toast.success("Prescription created.");
          onOpenChange(false);
          onCreated?.(rx.id);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create prescription</DialogTitle>
          <DialogDescription>Add medicines with dosage, frequency, and duration.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {(needsPatientPicker || needsDoctorPicker) && (
            <div className="grid grid-cols-2 gap-3">
              {needsPatientPicker && (
                <div className="space-y-1.5">
                  <Label>Patient</Label>
                  <PatientCombobox value={selectedPatientId} onChange={setSelectedPatientId} />
                </div>
              )}
              {needsDoctorPicker && (
                <div className="space-y-1.5">
                  <Label>Prescribing doctor</Label>
                  <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                    <SelectContent>
                      {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Medicine {index + 1}</p>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <Input placeholder="Medicine (e.g. Paracetamol)" {...register(`items.${index}.medicineName`)} />
                  </div>
                  <Input placeholder="Strength (e.g. 500 mg)" {...register(`items.${index}.strength`)} />
                  <Input placeholder="Dosage (e.g. 1 tablet)" {...register(`items.${index}.dosage`)} />
                  <Input placeholder="Frequency (e.g. Twice daily)" {...register(`items.${index}.frequency`)} />
                  <Input placeholder="Duration (e.g. 5 days)" {...register(`items.${index}.duration`)} />
                  <Input placeholder="Route (e.g. Oral)" {...register(`items.${index}.route`)} />
                  <Input placeholder="Instructions (optional)" className="col-span-2 sm:col-span-3" {...register(`items.${index}.instructions`)} />
                </div>
              </div>
            ))}
            {errors.items && <p className="text-xs text-danger">Complete all required fields for each medicine.</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyItem)}>
              <PlusIcon /> Add medicine
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rx-notes">Notes (optional)</Label>
            <Textarea id="rx-notes" rows={2} placeholder="Additional instructions for the patient..." {...register("notes")} />
          </div>

          <div className="rounded-lg border border-ai/20 bg-ai-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <SparklesIcon className="h-4 w-4 text-ai" /> AI Safety Review
              </p>
              <Button type="button" size="sm" variant="outline" onClick={runSafetyReview} disabled={safetyReview.isPending || !selectedPatientId}>
                {safetyReview.isPending ? "Checking…" : "Run review"}
              </Button>
            </div>
            {reviewFlags && (
              <div className="mt-2.5 space-y-1.5">
                {reviewFlags.length === 0 ? (
                  <p className="text-sm text-success">No issues detected. Please verify before signing.</p>
                ) : (
                  reviewFlags.map((flag, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-sm text-warning">
                      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {flag}
                    </p>
                  ))
                )}
                <p className="pt-1 text-xs text-muted-foreground">AI-generated · Decision support only — verify before signing.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createPrescription.isPending || !selectedPatientId || !selectedDoctorId}>
              {createPrescription.isPending ? "Saving…" : "Save prescription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

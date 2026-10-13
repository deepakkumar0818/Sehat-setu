"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, FileUpIcon, SparklesIcon, UploadCloudIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { LAB_REPORT_TYPES } from "@/data/pools";
import { useCreateReport } from "@/hooks/use-clinical";
import { useExtractDocument } from "@/hooks/use-ai";
import type { LabReportType } from "@/types";

interface UploadReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId?: string;
  onCreated?: (reportId: string) => void;
}

export function UploadReportDialog({ open, onOpenChange, patientId, onCreated }: UploadReportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [type, setType] = useState<LabReportType>("CBC");
  const [title, setTitle] = useState("CBC Report");
  const [notes, setNotes] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(patientId ?? "");
  const needsPatientPicker = !patientId;
  const extractDocument = useExtractDocument();
  const createReport = useCreateReport();

  useEffect(() => {
    if (!open) {
      setFileName(null);
      setType("CBC");
      setTitle("CBC Report");
      setNotes("");
      setSelectedPatientId(patientId ?? "");
      extractDocument.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = (file: File) => {
    setFileName(file.name);
  };

  const runExtraction = () => {
    if (!fileName) return;
    extractDocument.mutate(fileName, {
      onSuccess: (result) => {
        if (result.documentType === "lab_report") {
          setType("CBC");
          setTitle("CBC Report");
        }
        toast.success("Document analyzed. Review the extracted fields below.");
      },
    });
  };

  const handleSave = () => {
    if (!selectedPatientId) return;
    createReport.mutate(
      { patientId: selectedPatientId, type, title, notes: notes || undefined },
      {
        onSuccess: (report) => {
          toast.success("Report uploaded.");
          onOpenChange(false);
          onCreated?.(report.id);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload lab report</DialogTitle>
          <DialogDescription>Attach a report and optionally extract details with AI.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsPatientPicker && (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientCombobox value={selectedPatientId} onChange={setSelectedPatientId} />
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center hover:bg-muted/50"
          >
            {fileName ? (
              <>
                <FileUpIcon className="h-6 w-6 text-primary" />
                <p className="text-sm font-medium text-foreground">{fileName}</p>
                <p className="text-xs text-muted-foreground">Click to choose a different file</p>
              </>
            ) : (
              <>
                <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Drop medical document here</p>
                <p className="text-xs text-muted-foreground">or click to upload (PDF, JPG, PNG)</p>
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          {fileName && (
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={runExtraction} disabled={extractDocument.isPending}>
              <SparklesIcon className="text-ai" /> {extractDocument.isPending ? "Extracting with AI…" : "Extract with AI"}
            </Button>
          )}

          {extractDocument.data && (
            <div className="rounded-lg border border-ai/20 bg-ai-muted/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CheckCircle2Icon className="h-4 w-4 text-ai" /> Extracted fields ({extractDocument.data.confidence} confidence)
              </p>
              <dl className="space-y-1 text-sm">
                {extractDocument.data.fields.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="text-right font-medium text-foreground">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 border-t border-ai/15 pt-1.5 text-xs text-muted-foreground">{extractDocument.data.disclaimer}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Report type</Label>
              <Select value={type} onValueChange={(v) => setType(v as LabReportType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LAB_REPORT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-title">Title</Label>
              <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-notes">Notes (optional)</Label>
            <Textarea id="report-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={createReport.isPending || !fileName || !selectedPatientId}>
            {createReport.isPending ? "Saving…" : "Save report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

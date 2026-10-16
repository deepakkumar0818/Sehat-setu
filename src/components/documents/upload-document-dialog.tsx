"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUpIcon, UploadCloudIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { ApiRequestError } from "@/lib/api-client";
import {
  ADMIN_CATEGORIES,
  CATEGORY_LABEL,
  CLINICAL_CATEGORIES,
  FILE_REJECTION_MESSAGE,
  MAX_DOCUMENT_BYTES,
  checkDocumentBytes,
  type DocumentCategoryKey,
} from "@/lib/documents";
import { useUploadDocument } from "@/hooks/use-documents";
import type { UploadResult } from "@/lib/live-types";

// Live upload (P6.2). The browser checks the file first for quick feedback; the
// server re-validates the bytes and the database re-checks the caller.

export interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed patient (patient profile, lab report). Otherwise the user picks one. */
  patientId?: string;
  /** Attach to this existing lab report (category is LAB_REPORT). */
  labReport?: { id: string; title: string };
  consultationId?: string;
  canUploadClinical: boolean;
  canUploadAdministrative: boolean;
  /** False for upload-only users: warn that clinical files can't be opened after upload. */
  canViewClinical: boolean;
  defaultCategory?: DocumentCategoryKey;
  onUploaded?: (result: UploadResult) => void;
}

const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

/** Mounted only while open, so every opening starts from a clean form. */
export function UploadDocumentDialog(props: UploadDocumentDialogProps) {
  return props.open ? <UploadDocumentForm {...props} /> : null;
}

function UploadDocumentForm(props: UploadDocumentDialogProps) {
  const { onOpenChange, labReport, consultationId, canUploadClinical, canUploadAdministrative, canViewClinical, onUploaded } = props;
  const allowed: DocumentCategoryKey[] = labReport ? ["LAB_REPORT"] : [...(canUploadClinical ? CLINICAL_CATEGORIES : []), ...(canUploadAdministrative ? ADMIN_CATEGORIES : [])];
  const initialCategory = props.defaultCategory && allowed.includes(props.defaultCategory) ? props.defaultCategory : allowed[0];

  const inputRef = useRef<HTMLInputElement>(null);
  const [patientId, setPatientId] = useState<string | undefined>(props.patientId);
  const [category, setCategory] = useState<DocumentCategoryKey | undefined>(initialCategory);
  const [title, setTitle] = useState(labReport ? labReport.title : "");
  const [testType, setTestType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const upload = useUploadDocument();

  async function choose(f: File) {
    setFile(null);
    setFileError(null);
    if (f.size > MAX_DOCUMENT_BYTES) return setFileError(FILE_REJECTION_MESSAGE.too_large);
    const check = checkDocumentBytes(new Uint8Array(await f.arrayBuffer()), f.type, f.name);
    if (!check.ok) return setFileError(FILE_REJECTION_MESSAGE[check.reason]);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }

  const createsReport = category === "LAB_REPORT" && !labReport;
  const clinical = category ? (CLINICAL_CATEGORIES as readonly string[]).includes(category) : false;
  const ready = Boolean(patientId && category && title.trim() && file && (!createsReport || testType.trim())) && !upload.isPending;

  function submit() {
    if (!ready || !patientId || !category || !file) return;
    upload.mutate(
      {
        input: { patientId, file, category, title: title.trim(), labReportId: labReport?.id, consultationId, testType: createsReport ? testType.trim() : undefined },
        onProgress: setProgress,
      },
      {
        onSuccess: (result) => {
          toast.success(result.readable ? "Document uploaded." : "Uploaded. Clinical files are visible to clinicians only.");
          onUploaded?.(result);
          onOpenChange(false);
        },
      }
    );
  }

  const serverError = upload.error instanceof ApiRequestError ? upload.error.message : upload.error ? "The upload failed. Please try again." : null;

  return (
    <Dialog open onOpenChange={(o) => !upload.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labReport ? "Attach result file" : "Upload document"}</DialogTitle>
          <DialogDescription>PDF, JPEG or PNG, up to 8 MB. Files are stored privately and every view is recorded.</DialogDescription>
        </DialogHeader>

        {allowed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your role can&apos;t upload documents.</p>
        ) : (
          <div className="space-y-4">
            {!props.patientId && (
              <div className="space-y-1.5">
                <Label>Patient</Label>
                <PatientCombobox value={patientId} onChange={setPatientId} disabled={upload.isPending} />
              </div>
            )}

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/50"
            >
              {file ? (
                <>
                  <FileUpIcon className="h-6 w-6 text-primary" />
                  <p className="max-w-full truncate text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · click to choose a different file</p>
                </>
              ) : (
                <>
                  <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Choose a file</p>
                  <p className="text-xs text-muted-foreground">PDF, JPEG or PNG · max 8 MB</p>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label="File"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void choose(f);
              }}
            />
            {fileError && <p role="alert" className="text-sm text-danger">{fileError}</p>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as DocumentCategoryKey)} disabled={Boolean(labReport) || upload.isPending}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {allowed.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-title">Title</Label>
                <Input id="doc-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={upload.isPending} />
              </div>
            </div>

            {createsReport && (
              <div className="space-y-1.5">
                <Label htmlFor="doc-test">Test</Label>
                <Input id="doc-test" value={testType} maxLength={60} placeholder="e.g. CBC, Lipid profile" onChange={(e) => setTestType(e.target.value)} disabled={upload.isPending} />
                <p className="text-xs text-muted-foreground">A lab report is created for this result so the doctor can review it.</p>
              </div>
            )}

            {clinical && !canViewClinical && (
              <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
                You can upload clinical files, but you won&apos;t be able to open them afterwards. Only clinicians can.
              </p>
            )}

            {upload.isPending && <Progress value={Math.round(progress * 100)} aria-label="Upload progress" />}
            {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!ready}>{upload.isPending ? `Uploading… ${Math.round(progress * 100)}%` : "Upload"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

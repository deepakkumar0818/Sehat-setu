"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { ApiRequestError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { FILE_REJECTION_MESSAGE, LAB_REPORT_STATUS_LABEL, MAX_DOCUMENT_BYTES, checkDocumentBytes, type LabReportStatusKey } from "@/lib/documents";
import { useCreateLabReport, useLabReports, useUploadDocument } from "@/hooks/use-documents";
import type { LiveLabReport } from "@/lib/live-types";

// Live lab reports (P6.2). Clinicians see the worklist the database allows
// (doctors: their own patients in any branch; nurses: their branch).
// Upload-only roles (receptionists) can add results but never read them back.

const TONE: Record<LabReportStatusKey, "warning" | "info" | "success"> = { PENDING: "warning", AVAILABLE: "info", REVIEWED: "success" };

export function LabStatusBadge({ status }: { status: LabReportStatusKey }) {
  return <StatusBadge status={status.toLowerCase()} tone={TONE[status]} label={LAB_REPORT_STATUS_LABEL[status]} />;
}

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.");

export interface AddLabResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId?: string;
  consultationId?: string;
  defaultTestType?: string;
  /** readable=false for upload-only users (they can't open the report afterwards). */
  onCreated?: (reportId: string, readable: boolean) => void;
}

/** Registers a lab report, optionally with its result file (PDF/JPEG/PNG ≤ 8 MB). */
export function AddLabResultDialog(props: AddLabResultDialogProps) {
  return props.open ? <AddLabResultForm {...props} /> : null; // mounted only while open: a clean form every time
}

function AddLabResultForm({ onOpenChange, patientId: fixedPatient, consultationId, defaultTestType, onCreated }: AddLabResultDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [patientId, setPatientId] = useState(fixedPatient);
  const [testType, setTestType] = useState(defaultTestType ?? "");
  const [title, setTitle] = useState(defaultTestType ? `${defaultTestType} result` : "");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const create = useCreateLabReport();
  const upload = useUploadDocument();
  const pending = create.isPending || upload.isPending;

  async function choose(f: File) {
    setFile(null);
    setFileError(null);
    if (f.size > MAX_DOCUMENT_BYTES) return setFileError(FILE_REJECTION_MESSAGE.too_large);
    const check = checkDocumentBytes(new Uint8Array(await f.arrayBuffer()), f.type, f.name);
    if (!check.ok) return setFileError(FILE_REJECTION_MESSAGE[check.reason]);
    setFile(f);
  }

  const ready = Boolean(patientId && testType.trim() && title.trim()) && !pending;
  const done = (id: string, readable: boolean) => {
    toast.success(readable ? "Lab report added." : "Result added. The doctor can now review it.");
    onCreated?.(id, readable);
    onOpenChange(false);
  };

  function submit() {
    if (!ready || !patientId) return;
    if (file) {
      upload.mutate(
        { input: { patientId, file, category: "LAB_REPORT", title: title.trim(), testType: testType.trim(), consultationId }, onProgress: setProgress },
        { onSuccess: (r) => r.labReportId && done(r.labReportId, r.readable) }
      );
    } else {
      create.mutate({ patientId, testType: testType.trim(), title: title.trim(), consultationId }, { onSuccess: (r) => done(r.id, r.readable) });
    }
  }

  const error = upload.error ?? create.error;
  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add lab result</DialogTitle>
          <DialogDescription>Register the test and, if you have it, attach the result file. Values can be entered on the report afterwards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!fixedPatient && (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientCombobox value={patientId} onChange={setPatientId} disabled={pending} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lab-test">Test</Label>
              <Input id="lab-test" value={testType} maxLength={60} placeholder="e.g. CBC" onChange={(e) => setTestType(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lab-title">Title</Label>
              <Input id="lab-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Result file (optional)</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={pending}>Choose file</Button>
              <span className="truncate text-sm text-muted-foreground">{file ? file.name : "PDF, JPEG or PNG · max 8 MB"}</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="hidden"
              aria-label="Result file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void choose(f);
              }}
            />
            {fileError && <p role="alert" className="text-sm text-danger">{fileError}</p>}
          </div>
          {upload.isPending && <Progress value={Math.round(progress * 100)} aria-label="Upload progress" />}
          {error && <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={!ready}>{pending ? "Saving…" : "Add result"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LiveLabReports() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LabReportStatusKey | "all">("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const query = useLabReports({ search: search || undefined, status, page, pageSize: 15 });
  const data = query.data;

  const columns: DataTableColumn<LiveLabReport>[] = [
    { key: "date", header: "Added", render: (r) => formatDate(r.createdAt) },
    { key: "patient", header: "Patient", render: (r) => r.patientName ?? "—" },
    { key: "test", header: "Test", render: (r) => r.testType },
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "doctor", header: "Ordered by", render: (r) => r.orderedBy?.name ?? "—" },
    { key: "status", header: "Status", render: (r) => <LabStatusBadge status={r.status} /> },
  ];

  const addButton = data?.canCreate ? <Button onClick={() => setAddOpen(true)}><PlusIcon /> Add result</Button> : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title="Lab reports" description="Results awaiting values or review, and reviewed reports." actions={addButton} />

      {data && !data.canView ? (
        <EmptyState
          icon={FlaskConicalIcon}
          title="Add lab results"
          description="You can register tests and attach result files. Only clinicians can open lab reports."
          action={addButton}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by patient, test or title..." />
            <Select value={status} onValueChange={(v) => { setStatus(v as LabReportStatusKey | "all"); setPage(1); }}>
              <SelectTrigger className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="REVIEWED">Reviewed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {query.isError ? (
            <QueryError error={query.error} what="Lab reports" onRetry={() => query.refetch()} />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(r) => r.id}
                isLoading={query.isLoading}
                onRowClick={(r) => router.push(`/reports/${r.id}`)}
                className="rounded-none border-0"
                emptyState={<EmptyState icon={FlaskConicalIcon} title="No lab reports" description={search || status !== "all" ? "Try changing your filters." : "Lab results you can see will appear here."} />}
              />
              {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
            </div>
          )}
        </>
      )}

      <AddLabResultDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(id, readable) => readable && router.push(`/reports/${id}`)} />
    </div>
  );
}

/** Patient profile → Lab reports tab (live). */
export function LivePatientLabReports({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const query = useLabReports({ patientId, pageSize: 50 });
  const data = query.data;

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <QueryError error={query.error} what="Lab reports" onRetry={() => query.refetch()} />;
  return (
    <div className="space-y-3">
      {data?.canCreate && (
        <div className="flex justify-end"><Button size="sm" onClick={() => setAddOpen(true)}><PlusIcon /> Add result</Button></div>
      )}
      {!data || !data.canView ? (
        <EmptyState icon={FlaskConicalIcon} title="Lab reports are visible to clinicians only" description={data?.canCreate ? "You can still add results for this patient." : undefined} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={FlaskConicalIcon} title="No lab reports yet" description="Results added for this patient will appear here." />
      ) : (
        <div className="divide-y rounded-lg border">
          {data.items.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.testType} · {formatDate(r.createdAt)}{r.branch ? ` · ${r.branch.name}` : ""}</p>
              </div>
              <LabStatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}
      <AddLabResultDialog open={addOpen} onOpenChange={setAddOpen} patientId={patientId} onCreated={(id, readable) => readable && router.push(`/reports/${id}`)} />
    </div>
  );
}

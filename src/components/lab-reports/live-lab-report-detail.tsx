"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2Icon, PaperclipIcon, PencilIcon, PlusIcon, ShareIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { QueryError } from "@/components/shared/query-error";
import { DocumentList } from "@/components/documents/document-list";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { LabStatusBadge } from "@/components/lab-reports/live-lab-reports";
import { ApiRequestError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { LAB_FLAGS, type LabFlag, type LabValue } from "@/lib/documents";
import { useLabReport, useReviewLabReport, useSetLabValues, useShareLabReport } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";
import type { LiveLabReportDetail } from "@/lib/live-types";

// Live lab report (P6.2). Every button here is only a hint: the database
// function decides (assigned doctor reviews; review before sharing; values
// locked while shared; new values clear the review).

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.");
const FLAG_CLASS: Record<LabFlag, string> = { normal: "text-muted-foreground", low: "text-warning", high: "text-danger", abnormal: "text-danger" };
const NO_FLAG = "none";

function ValuesTable({ values }: { values: LabValue[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Parameter</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Reference range</TableHead>
          <TableHead>Flag</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {values.map((v, i) => (
          <TableRow key={`${v.parameter}-${i}`}>
            <TableCell className="font-medium">{v.parameter}</TableCell>
            <TableCell>{v.value ?? "—"} {v.unit ?? ""}</TableCell>
            <TableCell className="text-muted-foreground">{v.range ?? "—"}</TableCell>
            <TableCell>{v.flag ? <span className={cn("capitalize", FLAG_CLASS[v.flag])}>{v.flag}</span> : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const blankRow = (): LabValue => ({ parameter: "", value: "", unit: "", range: "", flag: null });

function ValuesEditor({ report, onDone }: { report: LiveLabReportDetail; onDone: () => void }) {
  const save = useSetLabValues();
  const [rows, setRows] = useState<LabValue[]>(report.values.length ? report.values.map((v) => ({ ...v })) : [blankRow()]);
  const [resultDate, setResultDate] = useState(report.resultDate ?? "");
  const [notes, setNotes] = useState(report.notes ?? "");
  const set = (i: number, patch: Partial<LabValue>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const filled = rows.filter((r) => r.parameter.trim() || r.value?.trim());
  const invalid = filled.some((r) => !r.parameter.trim()) || rows.length > 100;

  return (
    <div className="space-y-3">
      {report.status === "REVIEWED" && (
        <p className="rounded-md bg-warning/10 p-2.5 text-sm text-foreground">Saving new values clears the doctor&apos;s review; the report must be reviewed again.</p>
      )}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1.4fr_1fr_auto]">
            <Input aria-label={`Parameter ${i + 1}`} placeholder="Parameter" maxLength={120} value={row.parameter} onChange={(e) => set(i, { parameter: e.target.value })} />
            <Input aria-label={`Value ${i + 1}`} placeholder="Value" maxLength={120} value={row.value ?? ""} onChange={(e) => set(i, { value: e.target.value })} />
            <Input aria-label={`Unit ${i + 1}`} placeholder="Unit" maxLength={120} value={row.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value })} />
            <Input aria-label={`Range ${i + 1}`} placeholder="Reference range" maxLength={120} value={row.range ?? ""} onChange={(e) => set(i, { range: e.target.value })} />
            <Select value={row.flag ?? NO_FLAG} onValueChange={(v) => set(i, { flag: v === NO_FLAG ? null : (v as LabFlag) })}>
              <SelectTrigger aria-label={`Flag ${i + 1}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FLAG}>No flag</SelectItem>
                {LAB_FLAGS.map((f) => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2Icon /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, blankRow()])} disabled={rows.length >= 100}><PlusIcon /> Add row</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="lab-result-date">Result date</Label>
          <Input id="lab-result-date" type="date" value={resultDate} onChange={(e) => setResultDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-notes">Notes</Label>
          <Textarea id="lab-notes" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {invalid && <p role="alert" className="text-sm text-danger">Each row with a value needs a parameter name.</p>}
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      <div className="flex gap-2">
        <Button
          disabled={invalid || save.isPending}
          onClick={() =>
            save.mutate(
              { id: report.id, input: { values: filled, resultDate: resultDate || null, notes: notes.trim() || null } },
              { onSuccess: () => { toast.success("Values saved."); onDone(); } }
            )
          }
        >
          {save.isPending ? "Saving…" : "Save values"}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </div>
  );
}

export function LiveLabReportDetail({ id }: { id: string }) {
  const query = useLabReport(id);
  const review = useReviewLabReport();
  const share = useShareLabReport();
  const [editing, setEditing] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);

  if (query.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (query.isError) return <QueryError error={query.error} what="Lab reports" onRetry={() => query.refetch()} />;
  const report = query.data!;
  const shared = Boolean(report.sharedWithPatientAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{report.title}</h1>
            <LabStatusBadge status={report.status} />
            {shared && <span className="text-xs font-medium text-success">Shared with patient</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/patients/${report.patientId}`} className="hover:underline">{report.patientName ?? "Patient"}{report.patientNumber ? ` (${report.patientNumber})` : ""}</Link>
            {" · "}{report.testType}
            {report.branch ? ` · ${report.branch.name}` : ""}
            {report.orderedBy ? ` · Ordered by ${report.orderedBy.name}` : ""}
            {report.consultationId ? <> · <Link href={`/consultations/${report.consultationId}`} className="hover:underline">Consultation</Link></> : null}
          </p>
          {report.reviewedAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">Reviewed {formatDate(report.reviewedAt)}{report.reviewedByName ? ` by ${report.reviewedByName}` : ""}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {report.actions.canEditValues && !editing && <Button variant="outline" onClick={() => setEditing(true)}><PencilIcon /> {report.values.length ? "Edit values" : "Enter values"}</Button>}
          {report.actions.canReview && (
            <Button onClick={() => review.mutate(report.id, { onSuccess: () => toast.success("Report reviewed."), onError: (e) => toast.error(errorMessage(e)) })} disabled={review.isPending}>
              <CheckCircle2Icon /> {review.isPending ? "Reviewing…" : "Mark reviewed"}
            </Button>
          )}
          {report.actions.canShare && !shared && <Button variant="outline" onClick={() => setConfirmShare(true)} disabled={share.isPending}><ShareIcon /> Share with patient</Button>}
          {report.actions.canShare && shared && (
            <Button variant="outline" onClick={() => share.mutate({ id: report.id, shared: false }, { onSuccess: () => toast.success("No longer shared."), onError: (e) => toast.error(errorMessage(e)) })} disabled={share.isPending}>
              <Undo2Icon /> Stop sharing
            </Button>
          )}
        </div>
      </div>

      {shared && report.actions.canEditValues === false && (
        <p className="rounded-md bg-muted p-2.5 text-sm text-muted-foreground">Values are locked while the report is shared with the patient. Stop sharing to change them.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Results{report.resultDate ? ` · ${formatDate(report.resultDate)}` : ""}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <ValuesEditor report={report} onDone={() => setEditing(false)} />
            ) : report.values.length > 0 ? (
              <ValuesTable values={report.values} />
            ) : (
              <p className="text-sm text-muted-foreground">{report.status === "PENDING" ? "Waiting for the result." : "No structured values entered."}</p>
            )}
            {!editing && report.notes && <p className="whitespace-pre-wrap border-t pt-3 text-sm text-foreground">{report.notes}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-1.5"><PaperclipIcon className="h-4 w-4" /> Attachments</CardTitle>
            {report.actions.canAttach && <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}><PlusIcon /> Attach</Button>}
          </CardHeader>
          <CardContent>
            {report.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files attached.</p>
            ) : (
              <div className="[&>div]:grid-cols-1 [&>div]:sm:grid-cols-1 [&>div]:lg:grid-cols-1"><DocumentList items={report.attachments} /></div>
            )}
          </CardContent>
        </Card>
      </div>

      <UploadDocumentDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        patientId={report.patientId}
        labReport={{ id: report.id, title: report.title }}
        canUploadClinical
        canUploadAdministrative={false}
        canViewClinical
      />
      <ConfirmDialog
        open={confirmShare}
        onOpenChange={setConfirmShare}
        title="Share with patient?"
        description="The patient will be able to see this reviewed report and its result files in their portal. Values stay locked while it is shared."
        confirmLabel="Share"
        onConfirm={() => share.mutate({ id: report.id, shared: true }, { onSuccess: () => toast.success("Shared with patient."), onError: (e) => toast.error(errorMessage(e)) })}
      />
    </div>
  );
}

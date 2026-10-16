"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftIcon, DownloadIcon, EyeIcon, FileImageIcon, FileTextIcon, FlaskConicalIcon, FolderOpenIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { ApiRequestError } from "@/lib/api-client";
import { liveApi } from "@/lib/live-api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePortalDocuments, usePortalDownload, usePortalLabReport, usePortalLabReports } from "@/hooks/use-portal";
import type { LabFlag } from "@/lib/documents";
import type { PortalDocument, PortalLabReport } from "@/lib/live-types";
import { LivePortalDashboard } from "@/components/portal/live-portal-care";

// Patient portal screens with live data (P6.3). Everything shown comes from
// /api/v1/portal/*, which returns only the signed-in patient's own reviewed and
// shared lab reports and their result files. No demo data, no fallback.

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.");
const FLAG_CLASS: Record<LabFlag, string> = { normal: "text-muted-foreground", low: "text-warning", high: "text-danger", abnormal: "text-danger" };

function LoadError({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  return <ErrorState title={`Couldn't load your ${what}`} description={errorMessage(error)} onRetry={onRetry} />;
}

function ReportRow({ r }: { r: PortalLabReport }) {
  return (
    <Link href={`/portal/reports/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted" data-testid="portal-report">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {r.testType} · {r.resultDate ? `Result ${formatDate(r.resultDate)}` : `Shared ${formatDate(r.sharedAt)}`}
          {r.orderedByName ? ` · ${r.orderedByName}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{r.fileCount ? `${r.fileCount} file${r.fileCount > 1 ? "s" : ""}` : ""}</span>
    </Link>
  );
}

/** Portal home: the patient's own dashboard (profile, appointments, bills, shared records). */
export function LivePortalHome() {
  return <LivePortalDashboard />;
}

export function LivePortalReports() {
  const [page, setPage] = useState(1);
  const q = usePortalLabReports(page);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Lab reports</h1>
        <p className="text-sm text-muted-foreground">Reports your doctor has reviewed and shared with you.</p>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <LoadError error={q.error} what="lab reports" onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon={FlaskConicalIcon} title="No lab reports yet" description="When your doctor reviews a lab report and shares it with you, it appears here." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="divide-y">{q.data.items.map((r) => <ReportRow key={r.id} r={r} />)}</div>
          {q.data.total > q.data.pageSize && <DataTablePagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} />}
        </div>
      )}
    </div>
  );
}

function FileList({ files, showReport = false }: { files: PortalDocument[]; showReport?: boolean }) {
  const download = usePortalDownload();
  const [previewing, setPreviewing] = useState<PortalDocument | null>(null);
  return (
    <>
      <div className="divide-y rounded-lg border">
        {files.map((f) => {
          const Icon = f.mimeType === "application/pdf" ? FileTextIcon : FileImageIcon;
          return (
            <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="portal-file">
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {showReport && f.labReportTitle ? <><Link href={`/portal/reports/${f.labReportId}`} className="hover:underline">{f.labReportTitle}</Link> · </> : null}
                  {f.uploadedAt ? formatDate(f.uploadedAt) : ""} · {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                </p>
              </div>
              <div className="flex gap-1.5">
                {f.mimeType !== "application/pdf" && <Button size="sm" variant="outline" onClick={() => setPreviewing(f)}><EyeIcon /> View</Button>}
                <Button size="sm" variant="outline" disabled={download.isPending && download.variables === f.id} onClick={() => download.mutate(f.id, { onError: (e) => toast.error(errorMessage(e)) })}>
                  <DownloadIcon /> Download
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {previewing && <Preview file={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}

function Preview({ file, onClose }: { file: PortalDocument; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    liveApi.portal
      .preview(file.id)
      .then((u) => {
        objectUrl = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.title}</DialogTitle>
          <DialogDescription>{file.labReportTitle ?? "Result file"}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-48 items-center justify-center rounded-md bg-muted/40">
          {error ? (
            <p role="alert" className="p-4 text-sm text-danger">{error}</p>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private object URL, not an optimisable remote image
            <img src={url} alt={file.title} className="max-h-[70vh] w-auto object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LivePortalReportDetail({ id }: { id: string }) {
  const q = usePortalLabReport(id);
  const back = (
    <Button asChild variant="ghost" size="sm"><Link href="/portal/reports"><ArrowLeftIcon /> All lab reports</Link></Button>
  );
  if (q.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (q.isError) {
    // Unknown, unshared and other people's reports all look the same.
    if (q.error instanceof ApiRequestError && q.error.status === 404) {
      return (
        <div className="space-y-4">
          {back}
          <EmptyState icon={SearchXIcon} title="This report isn't available" description="It may not have been shared with you, or it may have been withdrawn. Please contact your clinic if you think this is a mistake." />
        </div>
      );
    }
    return <LoadError error={q.error} what="lab report" onRetry={() => q.refetch()} />;
  }
  const r = q.data!;
  return (
    <div className="space-y-5">
      {back}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{r.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {r.testType}
          {r.resultDate ? ` · Result date ${formatDate(r.resultDate)}` : ""}
          {r.reviewedAt ? ` · Reviewed ${formatDate(r.reviewedAt)}` : ""}
          {r.orderedByName ? ` · ${r.orderedByName}` : ""}
          {r.branchName ? ` · ${r.branchName}` : ""}
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Results</CardTitle></CardHeader>
        <CardContent>
          {r.values.length === 0 ? (
            <p className="text-sm text-muted-foreground">No values were entered for this report. See the attached file{r.files.length === 1 ? "" : "s"}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Reference range</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.values.map((v, i) => (
                  <TableRow key={`${v.parameter}-${i}`}>
                    <TableCell className="font-medium">{v.parameter}</TableCell>
                    <TableCell>{v.value ?? "—"} {v.unit ?? ""}</TableCell>
                    <TableCell className="text-muted-foreground">{v.range ?? "—"}</TableCell>
                    <TableCell>{v.flag ? <span className={cn("capitalize", FLAG_CLASS[v.flag])}>{v.flag}</span> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Files</h2>
        {r.files.length === 0 ? <p className="text-sm text-muted-foreground">No files attached.</p> : <FileList files={r.files} />}
      </div>
      <p className="text-xs text-muted-foreground">Please discuss your results with your doctor. Flags compare a value with its reference range and are not a diagnosis.</p>
    </div>
  );
}

export function LivePortalDocuments() {
  const [page, setPage] = useState(1);
  const q = usePortalDocuments(page);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Documents</h1>
        <p className="text-sm text-muted-foreground">Result files of lab reports your doctor has shared with you.</p>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <LoadError error={q.error} what="documents" onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon={FolderOpenIcon} title="No documents yet" description="Result files appear here once your doctor shares the lab report they belong to." />
      ) : (
        <>
          <FileList files={q.data.items} showReport />
          {q.data.total > q.data.pageSize && <div className="rounded-lg border"><DataTablePagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} /></div>}
        </>
      )}
    </div>
  );
}

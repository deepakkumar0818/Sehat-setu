"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArchiveIcon, DownloadIcon, EyeIcon, FileImageIcon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiRequestError } from "@/lib/api-client";
import { liveApi } from "@/lib/live-api";
import { formatDate } from "@/lib/format";
import { ARCHIVE_REASONS, ARCHIVE_REASON_LABEL, CATEGORY_LABEL, type ArchiveReason } from "@/lib/documents";
import { useArchiveDocument, useDownloadDocument } from "@/hooks/use-documents";
import type { LiveDocument } from "@/lib/live-types";

// Live document cards (P6.2). Opening a file always goes through the audited
// server route; there are no public or signed URLs.

const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.");

export function DocumentList({ items, showPatient = false }: { items: LiveDocument[]; showPatient?: boolean }) {
  const download = useDownloadDocument();
  const [previewing, setPreviewing] = useState<LiveDocument | null>(null);
  const [archiving, setArchiving] = useState<LiveDocument | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((doc) => {
          const Icon = doc.mimeType === "application/pdf" ? FileTextIcon : FileImageIcon;
          const archived = doc.status === "ARCHIVED";
          return (
            <div key={doc.id} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="document-card">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={doc.title}>{doc.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {showPatient && (
                      <>
                        <Link href={`/patients/${doc.patientId}`} className="hover:underline">{doc.patientName ?? "Patient"}</Link>
                        {" · "}
                      </>
                    )}
                    {doc.uploadedAt ? formatDate(doc.uploadedAt) : "—"} · {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                    {doc.branch ? ` · ${doc.branch.name}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{CATEGORY_LABEL[doc.category]}</Badge>
                {archived && <Badge variant="secondary">Archived{doc.archiveReason ? ` · ${ARCHIVE_REASON_LABEL[doc.archiveReason]}` : ""}</Badge>}
                {doc.labReportId && (
                  <Link href={`/reports/${doc.labReportId}`} className="text-xs text-primary hover:underline">Lab report</Link>
                )}
              </div>
              {!archived && (
                <div className="flex flex-wrap gap-1.5">
                  {doc.mimeType !== "application/pdf" && (
                    <Button size="sm" variant="outline" onClick={() => setPreviewing(doc)}><EyeIcon /> View</Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={download.isPending && download.variables === doc.id}
                    onClick={() => download.mutate(doc.id, { onError: (e) => toast.error(errorMessage(e)) })}
                  >
                    <DownloadIcon /> Download
                  </Button>
                  {doc.canArchive && (
                    <Button size="sm" variant="ghost" onClick={() => setArchiving(doc)}><ArchiveIcon /> Archive</Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PreviewDialog doc={previewing} onClose={() => setPreviewing(null)} />
      <ArchiveDialog doc={archiving} onClose={() => setArchiving(null)} />
    </>
  );
}

function PreviewDialog({ doc, onClose }: { doc: LiveDocument | null; onClose: () => void }) {
  // Keyed by document: each preview starts empty and loads its own private object URL.
  return doc ? <PreviewBody key={doc.id} doc={doc} onClose={onClose} /> : null;
}

function PreviewBody({ doc, onClose }: { doc: LiveDocument; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    liveApi.documents
      .preview(doc.id)
      .then((u) => {
        objectUrl = u;
        if (revoked) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{doc.title}</DialogTitle>
          <DialogDescription>{CATEGORY_LABEL[doc.category]}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-48 items-center justify-center rounded-md bg-muted/40">
          {error ? (
            <p role="alert" className="p-4 text-sm text-danger">{error}</p>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private object URL, not an optimisable remote image
            <img src={url} alt={doc.title} className="max-h-[70vh] w-auto object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({ doc, onClose }: { doc: LiveDocument | null; onClose: () => void }) {
  return doc ? <ArchiveBody key={doc.id} doc={doc} onClose={onClose} /> : null;
}

function ArchiveBody({ doc, onClose }: { doc: LiveDocument; onClose: () => void }) {
  const archive = useArchiveDocument();
  const [reason, setReason] = useState<ArchiveReason | undefined>();
  const [note, setNote] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && !archive.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive document</DialogTitle>
          <DialogDescription>Archived documents stay on record but can no longer be opened. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ArchiveReason)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a reason…" /></SelectTrigger>
              <SelectContent>
                {ARCHIVE_REASONS.map((r) => <SelectItem key={r} value={r}>{ARCHIVE_REASON_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archive-note">Note (optional)</Label>
            <Textarea id="archive-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {archive.error && <p role="alert" className="text-sm text-danger">{errorMessage(archive.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={archive.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!reason || archive.isPending}
            onClick={() =>
              reason &&
              archive.mutate({ id: doc.id, reason, note: note.trim() || undefined }, { onSuccess: () => { toast.success("Document archived."); onClose(); } })
            }
          >
            {archive.isPending ? "Archiving…" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

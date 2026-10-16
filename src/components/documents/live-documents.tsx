"use client";

import { useState } from "react";
import { FolderOpenIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { DocumentList } from "@/components/documents/document-list";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { useDocumentList, usePatientDocuments } from "@/hooks/use-documents";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, type DocumentCategoryKey } from "@/lib/documents";
import type { DocumentPage } from "@/lib/live-types";

// Live documents (P6.2): only what the database lets this user see — clinical
// files for clinicians, administrative files for front-desk roles. No demo data.

type Kind = "all" | "clinical" | "administrative";
type Status = "available" | "archived" | "all";

function StorageNotice({ page }: { page: DocumentPage | undefined }) {
  if (!page || page.storageConfigured) return null;
  return <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">Document storage isn&apos;t set up on this server, so files can&apos;t be uploaded or opened yet.</p>;
}

export function LiveDocuments() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [category, setCategory] = useState<DocumentCategoryKey | "all">("all");
  const [status, setStatus] = useState<Status>("available");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const query = useDocumentList({ search: search || undefined, kind, category, status, page, pageSize: 18 });
  const data = query.data;
  const canUpload = Boolean(data && (data.canUploadClinical || data.canUploadAdministrative) && data.storageConfigured);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Patient files stored privately for your clinic. Every view and download is recorded."
        actions={canUpload ? <Button onClick={() => setUploadOpen(true)}><UploadIcon /> Upload</Button> : undefined}
      />
      <StorageNotice page={data} />
      {data && !data.canViewClinical && (data.canUploadClinical ? (
        <p className="text-sm text-muted-foreground">You can upload clinical files (lab results, imaging) but only clinicians can open them, so they aren&apos;t listed here.</p>
      ) : null)}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by title, patient name or number..." />
        <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setCategory("all"); setPage(1); }}>
          <SelectTrigger className="w-40" aria-label="Kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            <SelectItem value="clinical">Clinical</SelectItem>
            <SelectItem value="administrative">Administrative</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => { setCategory(v as DocumentCategoryKey | "all"); setPage(1); }}>
          <SelectTrigger className="w-48" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v as Status); setPage(1); }}>
          <SelectTrigger className="w-36" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : query.isError ? (
        <QueryError error={query.error} what="Documents" onRetry={() => query.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FolderOpenIcon} title="No documents found" description={search || kind !== "all" || category !== "all" || status !== "available" ? "Try changing your filters." : "Uploaded patient files will appear here."} />
      ) : (
        <>
          <DocumentList items={data.items} showPatient />
          <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>
        </>
      )}

      {data && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          canUploadClinical={data.canUploadClinical}
          canUploadAdministrative={data.canUploadAdministrative}
          canViewClinical={data.canViewClinical}
        />
      )}
    </div>
  );
}

/** Patient profile → Documents tab (live). */
export function LivePatientDocuments({ patientId }: { patientId: string }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const query = usePatientDocuments(patientId, { status: showArchived ? "all" : "available", pageSize: 60 });
  const data = query.data;
  const canUpload = Boolean(data && (data.canUploadClinical || data.canUploadAdministrative) && data.storageConfigured);

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <QueryError error={query.error} what="Documents" onRetry={() => query.refetch()} />;
  return (
    <div className="space-y-3">
      <StorageNotice page={data} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide archived" : "Show archived"}</Button>
        {canUpload && <Button size="sm" onClick={() => setUploadOpen(true)}><UploadIcon /> Upload</Button>}
      </div>
      {!data || data.items.length === 0 ? (
        <EmptyState icon={FolderOpenIcon} title="No documents yet" description={data && !data.canViewClinical ? "Administrative files appear here. Clinical files are visible to clinicians only." : "Uploaded files for this patient will appear here."} />
      ) : (
        <DocumentList items={data.items} />
      )}
      {data && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          patientId={patientId}
          canUploadClinical={data.canUploadClinical}
          canUploadAdministrative={data.canUploadAdministrative}
          canViewClinical={data.canViewClinical}
        />
      )}
    </div>
  );
}

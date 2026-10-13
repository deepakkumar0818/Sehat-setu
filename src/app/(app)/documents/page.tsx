"use client";

import { useState } from "react";
import { FileTextIcon, FolderOpenIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useDocuments } from "@/hooks/use-clinical";
import { useDataStore } from "@/store/data-store";
import type { DocumentCategory } from "@/types";

const CATEGORIES: { value: DocumentCategory | "all"; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "prescription", label: "Prescriptions" },
  { value: "lab_report", label: "Lab reports" },
  { value: "invoice", label: "Invoices" },
  { value: "id_proof", label: "ID proof" },
  { value: "referral", label: "Referrals" },
  { value: "other", label: "Other" },
];

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDocuments({ search, category, page, pageSize: 18 });
  const patients = useDataStore((s) => s.db.patients);

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="All prescriptions, reports, and files across your clinic." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search documents..." />
        <Select value={category} onValueChange={(v) => { setCategory(v as DocumentCategory | "all"); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FolderOpenIcon} title="No documents found" description="Try changing your filters." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((doc) => {
              const patient = patients.find((p) => p.id === doc.patientId);
              return (
                <div key={doc.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileTextIcon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{patient?.name ?? "Unknown patient"} · {formatDate(doc.date)}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 capitalize">{doc.category.replace("_", " ")}</Badge>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border">
            <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}

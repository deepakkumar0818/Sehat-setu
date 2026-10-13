"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignatureIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { PrescriptionBuilderDialog } from "@/components/prescriptions/prescription-builder-dialog";
import { formatDate } from "@/lib/format";
import { usePrescriptions } from "@/hooks/use-clinical";
import { useLiveData } from "@/lib/data-source";
import type { PrescriptionStatus } from "@/types";
import type { PrescriptionWithNames } from "@/services/clinical";

export default function PrescriptionsPage() {
  const router = useRouter();
  // Live: a prescription belongs to a consultation, so it's written from the consultation workspace.
  const live = useLiveData();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PrescriptionStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = usePrescriptions({ search, status, page, pageSize: 10 });

  const columns: DataTableColumn<PrescriptionWithNames>[] = [
    { key: "number", header: "Prescription", render: (rx) => <span className="font-medium text-foreground">{rx.prescriptionNumber ?? rx.id}</span> },
    { key: "date", header: "Date", render: (rx) => formatDate(rx.date) },
    { key: "patient", header: "Patient", render: (rx) => rx.patientName },
    { key: "doctor", header: "Doctor", render: (rx) => rx.doctorName },
    { key: "medicines", header: "Medicines", render: (rx) => <span className="max-w-64 truncate">{rx.items.map((i) => i.medicineName).join(", ")}</span> },
    { key: "status", header: "Status", render: (rx) => <StatusBadge status={rx.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prescriptions"
        description="Digital prescriptions issued across your clinic."
        actions={live ? undefined : <Button onClick={() => setDialogOpen(true)}><PlusIcon /> New Prescription</Button>}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={live ? "Search by patient, doctor or prescription number..." : "Search by patient or doctor..."} />
        <Select value={status} onValueChange={(v) => { setStatus(v as PrescriptionStatus | "all"); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <ErrorState title="Couldn't load prescriptions" description={error.message} onRetry={() => refetch()} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(rx) => rx.id}
            isLoading={isLoading}
            onRowClick={(rx) => router.push(`/prescriptions/${rx.id}`)}
            className="rounded-none border-0"
            emptyState={
              <EmptyState
                icon={FileSignatureIcon}
                title="No prescriptions found"
                description={live ? "Prescriptions are written from a consultation." : "Try changing your filters or create a new prescription."}
                action={live ? undefined : <Button onClick={() => setDialogOpen(true)}><PlusIcon /> New Prescription</Button>}
              />
            }
          />
          {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
        </div>
      )}

      {!live && <PrescriptionBuilderDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/prescriptions/${id}`)} />}
    </div>
  );
}

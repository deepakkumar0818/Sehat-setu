"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StethoscopeIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { useConsultations } from "@/hooks/use-clinical";
import { useDoctorOptions } from "@/hooks/use-people";
import type { ConsultationStatus } from "@/types";
import type { ConsultationWithNames } from "@/services/clinical";

export default function ConsultationsPage() {
  const router = useRouter();
  const doctors = useDoctorOptions(); // live: the server ignores this filter for doctors (they only see their own)

  const [search, setSearch] = useState("");
  const [doctorId, setDoctorId] = useState("all");
  const [status, setStatus] = useState<ConsultationStatus | "all">("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useConsultations({ search, doctorId, status, page, pageSize: 10 });

  const columns: DataTableColumn<ConsultationWithNames>[] = [
    { key: "date", header: "Date", render: (c) => formatDate(c.date) },
    { key: "patient", header: "Patient", render: (c) => c.patientName },
    { key: "doctor", header: "Doctor", render: (c) => c.doctorName },
    { key: "complaint", header: "Chief Complaint", render: (c) => <span className="max-w-56 truncate">{c.chiefComplaint}</span> },
    { key: "diagnosis", header: "Diagnosis", render: (c) => c.diagnosis.join(", ") || "—" },
    { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Consultations" description="Review past and in-progress patient consultations." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by patient, doctor, or complaint..." />
        <div className="flex gap-2">
          <Select value={doctorId} onValueChange={(v) => { setDoctorId(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All doctors</SelectItem>
              {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v as ConsultationStatus | "all"); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Couldn't load consultations" description={error.message} onRetry={() => refetch()} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(c) => c.id}
            isLoading={isLoading}
            onRowClick={(c) => router.push(`/consultations/${c.id}`)}
            className="rounded-none border-0"
            emptyState={<EmptyState icon={StethoscopeIcon} title="No consultations found" description="Try changing your filters." />}
          />
          {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
        </div>
      )}
    </div>
  );
}

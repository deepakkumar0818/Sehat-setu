"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConicalIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { UploadReportDialog } from "@/components/reports/upload-report-dialog";
import { LAB_REPORT_TYPES } from "@/data/pools";
import { formatDate } from "@/lib/format";
import { useReports } from "@/hooks/use-clinical";
import type { LabReportStatus, LabReportType } from "@/types";
import type { LabReportWithNames } from "@/services/clinical";
import { LiveLabReports } from "@/components/lab-reports/live-lab-reports";
import { useLiveData } from "@/lib/data-source";

export default function ReportsPage() {
  // Live (Supabase mode): lab reports from the database (P6.2). Demo mode: the original mock screen.
  return useLiveData() ? <LiveLabReports /> : <DemoReportsPage />;
}

function DemoReportsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<LabReportType | "all">("all");
  const [status, setStatus] = useState<LabReportStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useReports({ search, type, status, page, pageSize: 10 });

  const columns: DataTableColumn<LabReportWithNames>[] = [
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    { key: "patient", header: "Patient", render: (r) => r.patientName },
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Lab reports, imaging, and diagnostic results."
        actions={<Button onClick={() => setDialogOpen(true)}><UploadIcon /> Upload Report</Button>}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by patient or report title..." />
        <div className="flex gap-2">
          <Select value={type} onValueChange={(v) => { setType(v as LabReportType | "all"); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {LAB_REPORT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v as LabReportStatus | "all"); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          onRowClick={(r) => router.push(`/reports/${r.id}`)}
          className="rounded-none border-0"
          emptyState={
            <EmptyState
              icon={FlaskConicalIcon}
              title="No reports found"
              description="Try changing your filters or upload a new report."
              action={<Button onClick={() => setDialogOpen(true)}><UploadIcon /> Upload Report</Button>}
            />
          }
        />
        {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
      </div>

      <UploadReportDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/reports/${id}`)} />
    </div>
  );
}

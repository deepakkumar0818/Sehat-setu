"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { PatientFormDialog } from "@/components/patients/patient-form-dialog";
import { PatientActions } from "@/components/patients/patient-actions";
import { formatFriendlyDate } from "@/lib/format";
import { useBranches } from "@/hooks/use-branches";
import { usePatients } from "@/hooks/use-patients";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDataStore } from "@/store/data-store";
import type { Patient, PatientStatus } from "@/types";

function useNextAppointmentLabel(patient: Patient): string {
  const appt = useDataStore((s) => (patient.nextAppointmentId ? s.db.appointments.find((a) => a.id === patient.nextAppointmentId) : undefined));
  if (!appt) return "—";
  return `${formatFriendlyDate(appt.date)}`;
}

export default function PatientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const branches = useBranches();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PatientStatus | "all">("all");
  const [branchId, setBranchId] = useState<string | "all">("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");

  // Each request re-verifies the session and runs its own transactions: query once typing pauses, not per keystroke.
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data, isLoading } = usePatients({ search: debouncedSearch, status, branchId, page, pageSize: 10 });

  const columns: DataTableColumn<Patient>[] = useMemo(
    () => [
      {
        key: "patient",
        header: "Patient",
        render: (p) => (
          <div className="flex items-center gap-2.5">
            <PersonAvatar name={p.name} color={p.avatarColor} size="sm" />
            <div>
              <p className="font-medium text-foreground">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.patientNumber ?? p.id}</p>
            </div>
          </div>
        ),
      },
      { key: "age", header: "Age / Gender", render: (p) => <span className="capitalize">{p.age} yrs · {p.gender}</span> },
      { key: "phone", header: "Phone", render: (p) => p.phone },
      { key: "lastVisit", header: "Last Visit", render: (p) => (p.lastVisit ? formatFriendlyDate(p.lastVisit) : "—") },
      { key: "nextAppointment", header: "Next Appointment", render: (p) => <NextAppointmentCell patient={p} /> },
      { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} label={p.canManageAccess && p.status === "inactive" ? "Blocked" : undefined} /> },
      {
        key: "actions",
        header: "",
        render: (p) =>
          p.canManageAccess ? (
            // Menu clicks (portalled, but bubbling through React) must not open the row.
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <PatientActions patient={p} />
            </div>
          ) : null,
      },
    ],
    []
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        description="Manage patient records and medical history."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon /> Add Patient
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search patients by name, ID, or phone..." />
        <div className="flex gap-2">
          <Select value={status} onValueChange={(v) => { setStatus(v as PatientStatus | "all"); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.id}
          isLoading={isLoading}
          onRowClick={(p) => router.push(`/patients/${p.id}`)}
          className="rounded-none border-0"
          emptyState={
            <EmptyState
              title="No patients found"
              description="Try changing your filters or add a new patient to get started."
              action={<Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Patient</Button>}
            />
          }
        />
        {data && data.items.length > 0 && (
          <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </div>

      <PatientFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/patients/${id}`)} />
    </div>
  );
}

function NextAppointmentCell({ patient }: { patient: Patient }) {
  const label = useNextAppointmentLabel(patient);
  return <span>{label}</span>;
}

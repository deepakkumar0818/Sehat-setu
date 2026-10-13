"use client";

import Link from "next/link";
import { VideoIcon } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { AppointmentActionsMenu } from "@/components/appointments/appointment-actions";
import { formatDate, formatTime12h } from "@/lib/format";
import { useDataStore } from "@/store/data-store";
import type { AppointmentWithNames } from "@/services/appointments";

function PatientCell({ appointment }: { appointment: AppointmentWithNames }) {
  const color = useDataStore((s) => s.db.patients.find((p) => p.id === appointment.patientId)?.avatarColor ?? "var(--chart-1)");
  return (
    <Link href={`/patients/${appointment.patientId}`} className="flex items-center gap-2.5 hover:underline">
      <PersonAvatar name={appointment.patientName} color={color} size="sm" />
      <span className="font-medium text-foreground">{appointment.patientName}</span>
    </Link>
  );
}

interface AppointmentsTableProps {
  rows: AppointmentWithNames[];
  isLoading?: boolean;
  showDoctorColumn?: boolean;
  showDateColumn?: boolean;
  emptyAction?: React.ReactNode;
}

export function AppointmentsTable({ rows, isLoading, showDoctorColumn = true, showDateColumn = false, emptyAction }: AppointmentsTableProps) {
  const columns: DataTableColumn<AppointmentWithNames>[] = [
    ...(showDateColumn ? [{ key: "date", header: "Date", render: (a: AppointmentWithNames) => formatDate(a.date) } as DataTableColumn<AppointmentWithNames>] : []),
    { key: "time", header: "Time", render: (a) => <span className="font-medium">{formatTime12h(a.time)}</span> },
    { key: "patient", header: "Patient", render: (a) => <PatientCell appointment={a} /> },
    ...(showDoctorColumn ? [{ key: "doctor", header: "Doctor", render: (a: AppointmentWithNames) => a.doctorName } as DataTableColumn<AppointmentWithNames>] : []),
    {
      key: "type",
      header: "Type",
      render: (a) => (
        <span className="inline-flex items-center gap-1 capitalize text-muted-foreground">
          {a.type === "online" && <VideoIcon className="h-3.5 w-3.5" />}
          {a.type.replace("_", " ")}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "payment", header: "Payment", render: (a) => (a.billingHidden ? <span className="text-muted-foreground">—</span> : <StatusBadge status={a.paymentStatus} />) },
    { key: "actions", header: "", render: (a) => <AppointmentActionsMenu appointment={a} />, className: "text-right" },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      isLoading={isLoading}
      emptyState={
        <EmptyState
          title="No appointments found"
          description="Try changing your filters or create a new appointment."
          action={emptyAction}
        />
      }
    />
  );
}

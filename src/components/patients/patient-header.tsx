"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, FileSignatureIcon, MailIcon, PhoneIcon, ReceiptIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { StartConsultationButton } from "@/components/patients/start-consultation-button";
import { AppointmentFormDialog } from "@/components/appointments/appointment-form-dialog";
import { PrescriptionBuilderDialog } from "@/components/prescriptions/prescription-builder-dialog";
import { ManualInvoiceDialog } from "@/components/billing/manual-invoice-dialog";
import { UploadReportDialog } from "@/components/reports/upload-report-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";
import { useBranches } from "@/hooks/use-branches";
import { useLiveData } from "@/lib/data-source";
import type { Doctor, Patient } from "@/types";

const NO_DOCTORS: Doctor[] = [];

export function PatientHeader({ patient }: { patient: Patient }) {
  const router = useRouter();
  const user = useCurrentUser();
  const live = useLiveData();
  const branch = useBranches().find((b) => b.id === patient.branchId);
  // Demo mode only (the actions using it are hidden with live data); never the demo store when live.
  const allDoctors = useDataStore((s) => (live ? NO_DOCTORS : s.db.doctors));
  const doctors = useMemo(() => allDoctors.filter((d) => d.branchId === patient.branchId), [allDoctors, patient.branchId]);

  const [bookOpen, setBookOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const prescribingDoctorId = user?.doctorId ?? doctors[0]?.id ?? "";

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <PersonAvatar name={patient.name} color={patient.avatarColor} size="xl" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{patient.name}</h1>
              <StatusBadge status={patient.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {patient.patientNumber ?? patient.id} · {patient.age} yrs · <span className="capitalize">{patient.gender}</span> · {branch?.name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline">Blood group: {patient.bloodGroup}</Badge>
              <span className="flex items-center gap-1"><PhoneIcon className="h-3.5 w-3.5" /> {patient.phone}</span>
              <span className="flex items-center gap-1"><MailIcon className="h-3.5 w-3.5" /> {patient.email}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setBookOpen(true)}>
            <CalendarPlusIcon /> Book Appointment
          </Button>
          {/* Clinical, billing and report actions join the live app in later phases. */}
          {!live && (
            <>
              <StartConsultationButton patient={patient} />
              <Button size="sm" variant="outline" onClick={() => setRxOpen(true)}>
                <FileSignatureIcon /> Create Prescription
              </Button>
              <Button size="sm" variant="outline" onClick={() => setInvoiceOpen(true)}>
                <ReceiptIcon /> Create Invoice
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                <UploadIcon /> Upload Report
              </Button>
            </>
          )}
        </div>
      </div>

      <AppointmentFormDialog open={bookOpen} onOpenChange={setBookOpen} patientId={patient.id} onCreated={() => router.refresh()} />
      <PrescriptionBuilderDialog
        open={rxOpen}
        onOpenChange={setRxOpen}
        patientId={patient.id}
        doctorId={prescribingDoctorId}
        onCreated={(id) => router.push(`/prescriptions/${id}`)}
      />
      <ManualInvoiceDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        patientId={patient.id}
        branchId={patient.branchId}
        onCreated={(id) => router.push(`/billing/${id}`)}
      />
      <UploadReportDialog open={uploadOpen} onOpenChange={setUploadOpen} patientId={patient.id} onCreated={(id) => router.push(`/reports/${id}`)} />
    </div>
  );
}

"use client";

import { use } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, DownloadIcon, PrinterIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { PrescriptionPreview } from "@/components/prescriptions/prescription-preview";
import { usePrescription } from "@/hooks/use-clinical";
import { useLiveData } from "@/lib/data-source";
import { useDataStore } from "@/store/data-store";

export default function PrescriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const live = useLiveData();
  const { data: prescription, isLoading, isError, refetch } = usePrescription(id);
  // Demo data keeps patient/doctor/branch in the mock store; the clinic database returns them with the prescription.
  const demoPatient = useDataStore((s) => (!live && prescription ? s.db.patients.find((p) => p.id === prescription.patientId) : undefined));
  const demoDoctor = useDataStore((s) => (!live && prescription ? s.db.doctors.find((d) => d.id === prescription.doctorId) : undefined));
  const demoBranch = useDataStore((s) => (demoDoctor ? s.db.branches.find((b) => b.id === demoDoctor.branchId) : undefined));

  if (isLoading) return <Skeleton className="h-[600px] w-full rounded-xl" />;
  if (isError || !prescription || (!live && (!demoPatient || !demoDoctor))) {
    return <ErrorState title="Couldn't load this prescription" onRetry={() => refetch()} />;
  }

  const patient = live
    ? { name: prescription.patientName, patientNumber: prescription.patientNumber, age: prescription.patientAge, gender: prescription.patientGender, allergies: prescription.patientAllergies ?? [] }
    : demoPatient!;
  const doctor = live
    ? { name: prescription.doctorName, qualifications: prescription.doctorQualifications, registrationNumber: prescription.doctorRegistration }
    : demoDoctor!;
  const branch = live ? { name: prescription.branchName, address: prescription.branchAddress, phone: prescription.branchPhone } : demoBranch;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Prescription {prescription.prescriptionNumber ?? prescription.id}</h1>
          <div className="mt-1"><StatusBadge status={prescription.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <DownloadIcon /> Download PDF
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon /> Print
          </Button>
          {/* The patient portal isn't on the clinic database yet, so live mode doesn't claim to share. */}
          {!live && (
            <Button variant="outline" onClick={() => toast.success("Available to the patient in their portal.")}>
              <SendIcon /> Send to Patient
            </Button>
          )}
        </div>
      </div>

      {prescription.aiReviewFlags.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-sm print:hidden">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-warning"><AlertTriangleIcon className="h-4 w-4" /> AI Safety Review flags</p>
          <ul className="list-inside list-disc space-y-0.5 text-foreground">
            {prescription.aiReviewFlags.map((flag, i) => <li key={i}>{flag}</li>)}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">AI-generated · Reviewed by prescribing doctor before signing.</p>
        </div>
      )}

      <PrescriptionPreview prescription={prescription} patient={patient} doctor={doctor} branch={branch} />
    </div>
  );
}

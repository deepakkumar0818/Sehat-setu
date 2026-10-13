"use client";

import { use } from "react";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { PrescriptionPreview } from "@/components/prescriptions/prescription-preview";
import { usePrescription } from "@/hooks/use-clinical";
import { useDataStore } from "@/store/data-store";

export default function PortalPrescriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: prescription, isLoading, isError, refetch } = usePrescription(id);
  const patient = useDataStore((s) => (prescription ? s.db.patients.find((p) => p.id === prescription.patientId) : undefined));
  const doctor = useDataStore((s) => (prescription ? s.db.doctors.find((d) => d.id === prescription.doctorId) : undefined));
  const branch = useDataStore((s) => (doctor ? s.db.branches.find((b) => b.id === doctor.branchId) : undefined));

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (isError || !prescription || !patient || !doctor) return <ErrorState title="Couldn't load this prescription" onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 print:hidden">
        <Button variant="outline" onClick={() => window.print()}><DownloadIcon /> Download</Button>
        <Button variant="outline" onClick={() => window.print()}><PrinterIcon /> Print</Button>
      </div>
      <PrescriptionPreview prescription={prescription} patient={patient} doctor={doctor} branch={branch} />
    </div>
  );
}

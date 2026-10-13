"use client";

import { use } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/shared/error-state";
import { PatientHeader } from "@/components/patients/patient-header";
import { OverviewTab } from "@/components/patients/tabs/overview-tab";
import { TimelineTab } from "@/components/patients/tabs/timeline-tab";
import { ConsultationsTab } from "@/components/patients/tabs/consultations-tab";
import { PrescriptionsTab } from "@/components/patients/tabs/prescriptions-tab";
import { ReportsTab } from "@/components/patients/tabs/reports-tab";
import { MedicinesTab } from "@/components/patients/tabs/medicines-tab";
import { DocumentsTab } from "@/components/patients/tabs/documents-tab";
import { BillingTab } from "@/components/patients/tabs/billing-tab";
import { AppointmentsTab } from "@/components/patients/tabs/appointments-tab";
import { usePatient } from "@/hooks/use-patients";
import { useLiveData } from "@/lib/data-source";
import { NotConnected } from "@/components/shared/not-connected";

export default function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: patient, isLoading, isError, refetch } = usePatient(id);
  const live = useLiveData();
  // Live data: tabs whose modules aren't on the database yet say so, rather than showing empty or demo data.
  const later = (feature: string, tab: React.ReactNode) => (live ? <NotConnected feature={feature} /> : tab);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !patient) {
    return <ErrorState title="Couldn't load this patient" description="The patient record may not exist, or something went wrong." onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-5">
      <PatientHeader patient={patient} />

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="consultations">Consultations</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="medicines">Medicines</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="overview"><OverviewTab patient={patient} /></TabsContent>
          <TabsContent value="timeline" id="timeline"><TimelineTab patientId={patient.id} /></TabsContent>
          <TabsContent value="consultations"><ConsultationsTab patientId={patient.id} /></TabsContent>
          <TabsContent value="prescriptions"><PrescriptionsTab patientId={patient.id} /></TabsContent>
          <TabsContent value="reports">{later("Lab reports", <ReportsTab patientId={patient.id} />)}</TabsContent>
          <TabsContent value="medicines"><MedicinesTab patientId={patient.id} /></TabsContent>
          <TabsContent value="documents">{later("Documents", <DocumentsTab patientId={patient.id} />)}</TabsContent>
          <TabsContent value="billing"><BillingTab patientId={patient.id} /></TabsContent>
          <TabsContent value="appointments"><AppointmentsTab patientId={patient.id} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

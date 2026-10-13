"use client";

import { BuildingIcon, MapPinIcon, PhoneIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { PublicDoctorCard } from "@/components/public/public-doctor-card";
import { useClinic, useClinicDoctors } from "@/hooks/use-clinics";
import { useNextAvailableSlots } from "@/hooks/use-availability";

export function ClinicProfileClient({ clinicId }: { clinicId: string }) {
  const { data: clinic, isLoading, isError, refetch } = useClinic(clinicId);
  const { data: doctors, isLoading: doctorsLoading } = useClinicDoctors(clinicId);
  const doctorIds = doctors?.map((d) => d.id) ?? [];
  const { data: nextSlots } = useNextAvailableSlots(doctorIds);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !clinic) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <ErrorState title="Clinic not found" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="rounded-2xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <BuildingIcon className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{clinic.name}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="h-4 w-4" /> {clinic.address}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><PhoneIcon className="h-4 w-4" /> {clinic.phone}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {clinic.specialties.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Open Mon–Sat, 9:00 AM – 5:00 PM · {doctors?.some((d) => d.onlineConsultation) ? (
                <span className="inline-flex items-center gap-1 text-info"><VideoIcon className="h-3.5 w-3.5" /> Online consultations available</span>
              ) : "In-person only"}
            </p>
          </div>
        </div>
      </div>

      <h2 className="mt-10 text-xl font-semibold text-foreground">Doctors at this clinic</h2>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {doctorsLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
        ) : doctors && doctors.length > 0 ? (
          doctors.map((doctor) => (
            <PublicDoctorCard key={doctor.id} doctor={doctor} clinicName={clinic.name} nextAvailable={nextSlots?.[doctor.id]} />
          ))
        ) : (
          <EmptyState title="No doctors listed yet" description="Check back soon." />
        )}
      </div>
    </div>
  );
}

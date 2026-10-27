"use client";

import { use } from "react";
import { MailIcon, PhoneIcon, StarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { formatCurrency } from "@/lib/format";
import { useDoctor } from "@/hooks/use-people";
import { useTodaysAppointments } from "@/hooks/use-appointments";
import { useBranches } from "@/hooks/use-branches";
import { useLiveData } from "@/lib/data-source";

export default function DoctorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: doctor, isLoading, isError, refetch } = useDoctor(id);
  const live = useLiveData();
  const branch = useBranches().find((b) => b.id === doctor?.branchId);
  // Live: every branch the viewer can see (the doctor may work at several); filtered to this doctor below.
  const today = useTodaysAppointments(live ? undefined : doctor?.branchId);
  const { data: todaysAppts, isLoading: apptsLoading } = today;

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (isError || !doctor) return <ErrorState title="Couldn't load this doctor" onRetry={() => refetch()} />;

  const doctorAppts = (todaysAppts ?? []).filter((a) => a.doctorId === doctor.id);
  const completedCount = doctorAppts.filter((a) => a.status === "completed").length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="xl" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">{doctor.name}</h1>
                <StatusBadge status={doctor.status} />
              </div>
              <p className="text-sm text-muted-foreground">{doctor.qualifications}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="outline">{doctor.specialization}</Badge>
                {doctor.rating !== null && <span className="flex items-center gap-1 text-warning"><StarIcon className="h-3.5 w-3.5 fill-current" /> {doctor.rating.toFixed(1)}</span>}
                <span className="flex items-center gap-1"><PhoneIcon className="h-3.5 w-3.5" /> {doctor.phone}</span>
                <span className="flex items-center gap-1"><MailIcon className="h-3.5 w-3.5" /> {doctor.email}</span>
              </div>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{doctor.bio}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Consultation fee</p>
            <p className="text-lg font-semibold text-foreground">{formatCurrency(doctor.consultationFee)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{branch?.name}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's Appointments" value={today.isError ? "—" : String(doctorAppts.length)} isLoading={apptsLoading} />
        <StatCard label="Completed Today" value={today.isError ? "—" : String(completedCount)} isLoading={apptsLoading} />
        <StatCard label="Experience" value={`${doctor.experienceYears} yrs`} />
        <StatCard label="Online Consultations" value={doctor.onlineConsultation ? "Enabled" : "Not offered"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{live ? "Clinic hours" : "Weekly availability"}</CardTitle>
          {live && (
            <p className="text-xs text-muted-foreground">
              The clinic&apos;s opening hours, used for every doctor (break and appointment length are in Settings → Clinic timings). Individual doctor schedules aren&apos;t recorded, so this is not this doctor&apos;s personal availability.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {doctor.availability.map((slot) => (
              <div key={slot.day} className="rounded-md border p-2 text-center text-sm">
                <p className="font-medium text-foreground">{slot.day}</p>
                <p className="text-xs text-muted-foreground">{slot.start} – {slot.end}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Today&apos;s schedule</CardTitle></CardHeader>
        <CardContent className="p-0">
          {today.isError ? (
            <ErrorState title="Couldn't load today's appointments" description={today.error.message} onRetry={() => today.refetch()} className="m-4" />
          ) : (
            <AppointmentsTable rows={doctorAppts} isLoading={apptsLoading} showDoctorColumn={false} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

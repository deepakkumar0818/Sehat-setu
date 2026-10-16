"use client";

import { Suspense, useState } from "react";
import { LivePortalAppointments } from "@/components/portal/live-portal-care";
import { useLiveData } from "@/lib/data-source";
import type { PortalAppointmentScope } from "@/lib/live-types";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDaysIcon, PlusIcon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AppointmentFormDialog } from "@/components/appointments/appointment-form-dialog";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatDate, formatTime12h } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAppointments, useCancelAppointment } from "@/hooks/use-appointments";
import { useDataStore } from "@/store/data-store";
import type { AppointmentWithNames } from "@/services/appointments";

function AppointmentCard({ appt, onCancel }: { appt: AppointmentWithNames; onCancel: () => void }) {
  const router = useRouter();
  const doctor = useDataStore((s) => s.db.doctors.find((d) => d.id === appt.doctorId));
  const canManage = appt.status === "upcoming";
  const canJoin = appt.type === "online" && (appt.status === "upcoming" || appt.status === "waiting" || appt.status === "in_consultation");

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {doctor && <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="md" />}
        <div>
          <p className="font-medium text-foreground">{doctor?.name ?? "Doctor"}</p>
          <p className="text-sm text-muted-foreground">{formatDate(appt.date)} · {formatTime12h(appt.time)} · <span className="capitalize">{appt.type.replace("_", " ")}</span></p>
          <div className="mt-1"><StatusBadge status={appt.status} /></div>
        </div>
      </div>
      <div className="flex gap-2">
        {canJoin && (
          <Button size="sm" onClick={() => router.push(`/portal/consultation/${appt.id}`)}>
            <VideoIcon /> Join
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </div>
  );
}

function DemoPortalAppointmentsPage() {
  const user = useCurrentUser();
  const [bookOpen, setBookOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const cancelAppointment = useCancelAppointment();

  const upcoming = useAppointments({ patientId: user?.patientId, status: "upcoming", pageSize: 50 });
  const past = useAppointments({ patientId: user?.patientId, pageSize: 50 });
  const pastItems = (past.data?.items ?? []).filter((a) => a.status !== "upcoming");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Appointments"
        description="View, book, and manage your appointments."
        actions={<Button onClick={() => setBookOpen(true)}><PlusIcon /> Book Appointment</Button>}
      />

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4 space-y-3">
          {upcoming.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : upcoming.data && upcoming.data.items.length > 0 ? (
            upcoming.data.items.map((a) => <AppointmentCard key={a.id} appt={a} onCancel={() => setCancelTarget(a.id)} />)
          ) : (
            <EmptyState icon={CalendarDaysIcon} title="No upcoming appointments" description="Book an appointment to get started." action={<Button onClick={() => setBookOpen(true)}>Book Appointment</Button>} />
          )}
        </TabsContent>
        <TabsContent value="past" className="mt-4 space-y-3">
          {past.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : pastItems.length > 0 ? (
            pastItems.map((a) => <AppointmentCard key={a.id} appt={a} onCancel={() => setCancelTarget(a.id)} />)
          ) : (
            <EmptyState icon={CalendarDaysIcon} title="No past appointments" />
          )}
        </TabsContent>
      </Tabs>

      <AppointmentFormDialog open={bookOpen} onOpenChange={setBookOpen} patientId={user?.patientId} />
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel this appointment?"
        description="You can always book a new appointment later."
        confirmLabel="Cancel appointment"
        destructive
        isLoading={cancelAppointment.isPending}
        onConfirm={() => {
          if (cancelTarget) {
            cancelAppointment.mutate(cancelTarget, { onSuccess: () => { toast.success("Appointment cancelled."); setCancelTarget(null); } });
          }
        }}
      />
    </div>
  );
}

export default function PortalAppointmentsPage() {
  // Live (signed-in patient): their own records from the clinic database. Demo mode: the original mock page.
  return useLiveData() ? <Suspense fallback={null}><LiveAppointmentsFromUrl /></Suspense> : <DemoPortalAppointmentsPage />;
}

/** ?tab=past|cancelled|all opens that tab (e.g. from Home's "Recent visits"). */
function LiveAppointmentsFromUrl() {
  const tab = useSearchParams().get("tab");
  const initial: PortalAppointmentScope = tab === "past" || tab === "cancelled" || tab === "all" ? tab : "upcoming";
  return <LivePortalAppointments initialTab={initial} />;
}

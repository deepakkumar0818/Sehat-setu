"use client";

import { useRouter } from "next/navigation";
import { differenceInMinutes } from "date-fns";
import { ArmchairIcon, PlayCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useWaitingRoom } from "@/hooks/use-appointments";
import { useStartConsultation } from "@/hooks/use-appointments";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";
import { QueryError } from "@/components/shared/query-error";
import type { Doctor, Patient } from "@/types";
import { useUiStore } from "@/store/ui-store";
import { useAppNow, useLiveData } from "@/lib/data-source";
import { cn } from "@/lib/utils";

const NO_PATIENTS: Patient[] = [];
const NO_DOCTORS: Doctor[] = [];

export default function WaitingRoomPage() {
  const router = useRouter();
  const user = useCurrentUser();
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const live = useLiveData();
  const now = useAppNow();
  // Live: the server already limits branch-restricted users; only an explicit branch choice filters further.
  const { data, isLoading, isError, error, refetch } = useWaitingRoom(live ? (activeBranchId ?? undefined) : (activeBranchId ?? user?.branchId));
  const startConsultation = useStartConsultation();
  // Demo mode only: avatar colours/names from the in-browser store. Live rows carry their own names.
  const patients = useDataStore((s) => (live ? NO_PATIENTS : s.db.patients));
  const doctors = useDataStore((s) => (live ? NO_DOCTORS : s.db.doctors));

  return (
    <div className="space-y-5">
      <PageHeader title="Waiting Room" description="Live view of patients waiting or currently in consultation." />

      {isError ? (
        <QueryError error={error} what="Waiting room" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={ArmchairIcon} title="No one is waiting" description="Checked-in patients and active consultations will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((appt, index) => {
            const patient = patients.find((p) => p.id === appt.patientId);
            const doctor = doctors.find((d) => d.id === appt.doctorId);
            const waitMinutes = appt.waitStartedAt ? Math.max(0, differenceInMinutes(now, new Date(appt.waitStartedAt))) : 0;

            return (
              <div key={appt.id} className={cn("rounded-lg border p-4", appt.status === "in_consultation" && "border-primary/40 bg-accent/30")}>
                <div className="flex items-start justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">#{String(index + 1).padStart(2, "0")}</span>
                  <StatusBadge status={appt.status} />
                </div>
                <div className="mt-2 flex items-center gap-2.5">
                  <PersonAvatar name={appt.patientName} color={patient?.avatarColor ?? "var(--chart-1)"} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{appt.patientName}</p>
                    <p className="truncate text-xs text-muted-foreground">{doctor?.name ?? appt.doctorName}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {appt.status === "waiting" ? `Waiting — ${waitMinutes} min` : `In consultation — ${waitMinutes} min`}
                </p>
                <div className="mt-3">
                  {live && !appt.canConsult ? (
                    // Live: only the appointment's own doctor starts or continues the consultation.
                    <p className="text-xs text-muted-foreground">With {appt.doctorName}</p>
                  ) : appt.status === "waiting" ? (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={startConsultation.isPending}
                      onClick={() =>
                        startConsultation.mutate(appt.id, {
                          onSuccess: ({ consultation }) => router.push(`/consultations/${consultation.id}`),
                        })
                      }
                    >
                      <PlayCircleIcon /> Start Consultation
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => appt.consultationId && router.push(`/consultations/${appt.consultationId}`)}>
                      Continue Consultation
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

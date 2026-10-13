"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CalendarClockIcon, CheckCircle2Icon, ClockIcon, FlaskConicalIcon, SparklesIcon, UsersIcon, VideoIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { StatCard } from "@/components/shared/stat-card";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatDate } from "@/lib/format";
import { getGreetingName } from "@/lib/auth";
import { todayDateStr } from "@/lib/demo-clock";
import { useTodaysAppointments } from "@/hooks/use-appointments";
import { useConsultations, useReports } from "@/hooks/use-clinical";
import { useDataStore } from "@/store/data-store";
import type { AuthUser } from "@/types";

export function DoctorDashboard({ user }: { user: AuthUser }) {
  const { data: allTodays, isLoading: apptsLoading } = useTodaysAppointments(user.branchId);
  const { data: reportsData, isLoading: reportsLoading } = useReports({ status: "pending", pageSize: 50 });
  const { data: consultationsData } = useConsultations({ doctorId: user.doctorId, pageSize: 50 });
  const patients = useDataStore((s) => s.db.patients);

  const todaysAppointments = useMemo(() => (allTodays ?? []).filter((a) => a.doctorId === user.doctorId), [allTodays, user.doctorId]);
  const pendingReports = useMemo(() => (reportsData?.items ?? []).filter((r) => r.doctorId === user.doctorId), [reportsData, user.doctorId]);
  const followUps = useMemo(
    () => (consultationsData?.items ?? []).filter((c) => c.followUpDate && c.followUpDate >= todayDateStr()).slice(0, 5),
    [consultationsData]
  );

  const recentPatientIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const c of consultationsData?.items ?? []) {
      if (!seen.has(c.patientId)) {
        seen.add(c.patientId);
        ids.push(c.patientId);
      }
      if (ids.length >= 5) break;
    }
    return ids;
  }, [consultationsData]);

  const waiting = todaysAppointments.filter((a) => a.status === "waiting").length;
  const completed = todaysAppointments.filter((a) => a.status === "completed").length;
  const online = todaysAppointments.filter((a) => a.type === "online").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <GreetingHeader name={getGreetingName(user)} subtitle="Here's your schedule and patients for today." />
        <Button asChild size="sm" variant="outline">
          <Link href="/ai-assistant">
            <SparklesIcon className="text-ai" /> Ask Sehat AI
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's Patients" value={String(todaysAppointments.length)} icon={UsersIcon} isLoading={apptsLoading} />
        <StatCard label="Waiting" value={String(waiting)} icon={ClockIcon} tone={waiting > 3 ? "warning" : "default"} isLoading={apptsLoading} />
        <StatCard label="Completed" value={String(completed)} icon={CheckCircle2Icon} isLoading={apptsLoading} />
        <StatCard label="Online Consultations" value={String(online)} icon={VideoIcon} isLoading={apptsLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s schedule</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AppointmentsTable rows={todaysAppointments} isLoading={apptsLoading} showDoctorColumn={false} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent patients</CardTitle>
          </CardHeader>
          <CardContent>
            {recentPatientIds.length === 0 ? (
              <EmptyState title="No recent patients yet" className="border-0 py-8" />
            ) : (
              <div className="space-y-1">
                {recentPatientIds.map((id) => {
                  const patient = patients.find((p) => p.id === id);
                  if (!patient) return null;
                  return (
                    <Link key={id} href={`/patients/${id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted">
                      <PersonAvatar name={patient.name} color={patient.avatarColor} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">{patient.age} yrs · {patient.gender}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending reports &amp; follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <FlaskConicalIcon className="h-3.5 w-3.5" /> Pending reports
              </p>
              {reportsLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : pendingReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending reports.</p>
              ) : (
                <div className="space-y-1.5">
                  {pendingReports.slice(0, 4).map((r) => (
                    <Link key={r.id} href={`/reports/${r.id}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <span>{r.patientName} · {r.type}</span>
                      <Badge variant="outline">{formatDate(r.date)}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <CalendarClockIcon className="h-3.5 w-3.5" /> Upcoming follow-ups
              </p>
              {followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>
              ) : (
                <div className="space-y-1.5">
                  {followUps.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
                      <span>{c.patientName}</span>
                      <Badge variant="outline">{formatDate(c.followUpDate!)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

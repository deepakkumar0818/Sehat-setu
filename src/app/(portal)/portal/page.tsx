"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarDaysIcon,
  FileSignatureIcon,
  FileTextIcon,
  FlaskConicalIcon,
  VideoIcon,
  WalletIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { AppointmentFormDialog } from "@/components/appointments/appointment-form-dialog";
import { formatDate, formatTime12h } from "@/lib/format";
import { getGreetingName } from "@/lib/auth";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAppointments } from "@/hooks/use-appointments";
import { useDataStore } from "@/store/data-store";
import { todayDateStr } from "@/lib/demo-clock";
import { useLiveData } from "@/lib/data-source";
import { LivePortalHome } from "@/components/portal/live-portal";

const QUICK_ACTIONS = [
  { href: "#book", label: "Book Appointment", icon: CalendarDaysIcon },
  { href: "/portal/consultations", label: "Online Consultation", icon: VideoIcon },
  { href: "/portal/prescriptions", label: "Prescriptions", icon: FileSignatureIcon },
  { href: "/portal/reports", label: "Reports", icon: FlaskConicalIcon },
  { href: "/portal/payments", label: "Payments", icon: WalletIcon },
  { href: "/portal/documents", label: "Documents", icon: FileTextIcon },
];

export default function PortalHomePage() {
  // Live (signed-in patient): the patient's own shared records (P6.3). Demo mode: the original mock home.
  return useLiveData() ? <LivePortalHome /> : <DemoPortalHomePage />;
}

function DemoPortalHomePage() {
  const user = useCurrentUser();
  const [bookOpen, setBookOpen] = useState(false);
  const doctors = useDataStore((s) => s.db.doctors);
  const today = todayDateStr();
  const { data, isLoading } = useAppointments({ patientId: user?.patientId, status: "upcoming", dateFrom: today, pageSize: 1 });
  const next = data?.items[0];
  const doctor = next ? doctors.find((d) => d.id === next.doctorId) : undefined;

  if (!user) return null;

  return (
    <div className="space-y-6">
      <GreetingHeader name={getGreetingName(user)} subtitle="Here's an overview of your care." />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your next appointment</p>
            {isLoading ? (
              <Skeleton className="mt-2 h-6 w-48" />
            ) : next && doctor ? (
              <div className="mt-1 flex items-center gap-2.5">
                <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="md" />
                <div>
                  <p className="font-semibold text-foreground">{doctor.name}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(next.date)} · {formatTime12h(next.time)}</p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">You don&apos;t have any upcoming appointments.</p>
            )}
          </div>
          {next ? (
            <Button asChild variant="outline"><Link href="/portal/appointments">View Appointment</Link></Button>
          ) : (
            <Button onClick={() => setBookOpen(true)}>Book Appointment</Button>
          )}
        </CardContent>
      </Card>

      <div>
        <p className="mb-3 text-sm font-medium text-foreground">Quick Actions</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_ACTIONS.map((action) =>
            action.href === "#book" ? (
              <button
                key={action.label}
                onClick={() => setBookOpen(true)}
                className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-primary"><action.icon className="h-5 w-5" /></div>
                <span className="text-sm font-medium text-foreground">{action.label}</span>
              </button>
            ) : (
              <Link
                key={action.label}
                href={action.href}
                className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-primary"><action.icon className="h-5 w-5" /></div>
                <span className="text-sm font-medium text-foreground">{action.label}</span>
              </Link>
            )
          )}
        </div>
      </div>

      <AppointmentFormDialog open={bookOpen} onOpenChange={setBookOpen} patientId={user.patientId} />
    </div>
  );
}

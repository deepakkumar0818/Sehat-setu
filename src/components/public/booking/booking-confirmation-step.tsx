"use client";

import Link from "next/link";
import { CalendarPlusIcon, CheckCircle2Icon, LayoutDashboardIcon, ReceiptTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatTime12h } from "@/lib/format";
import type { BookingConfirmation } from "@/services/booking";
import type { Doctor } from "@/types";

interface BookingConfirmationStepProps {
  confirmation: BookingConfirmation;
  doctor: Doctor;
  clinicName: string;
}

export function BookingConfirmationStep({ confirmation, doctor, clinicName }: BookingConfirmationStepProps) {
  const { appointment, invoice } = confirmation;

  const calendarHref = (() => {
    const start = `${appointment.date.replace(/-/g, "")}T${appointment.time.replace(":", "")}00`;
    const title = encodeURIComponent(`Appointment with ${doctor.name}`);
    const details = encodeURIComponent(`${appointment.type === "online" ? "Online consultation" : "In-person visit"} at ${clinicName}. Reason: ${appointment.reason}`);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${start}&details=${details}`;
  })();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2Icon className="h-8 w-8 text-success" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-foreground">Appointment confirmed</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your booking with {doctor.name} is confirmed. A confirmation has been added to your patient record.
      </p>

      <div className="mt-6 w-full max-w-sm rounded-xl border bg-card p-4 text-left">
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Appointment ID</dt>
            <dd className="font-medium text-foreground">{appointment.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Doctor</dt>
            <dd className="font-medium text-foreground">{doctor.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Clinic</dt>
            <dd className="font-medium text-foreground">{clinicName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Date &amp; time</dt>
            <dd className="font-medium text-foreground">{formatDate(appointment.date)} · {formatTime12h(appointment.time)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Type</dt>
            <dd className="font-medium text-foreground capitalize">{appointment.type === "online" ? "Online" : "In-person"}</dd>
          </div>
          <div className="flex justify-between border-t pt-2.5">
            <dt className="text-muted-foreground">Amount paid</dt>
            <dd className="font-semibold text-foreground">{formatCurrency(invoice.total)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        <Button asChild size="lg" className="flex-1">
          <Link href="/portal"><LayoutDashboardIcon /> Go to patient portal</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="flex-1">
          <a href={calendarHref} target="_blank" rel="noopener noreferrer"><CalendarPlusIcon /> Add to calendar</a>
        </Button>
      </div>
      <Button asChild variant="ghost" size="sm" className="mt-2">
        <Link href="/portal/payments"><ReceiptTextIcon /> View invoice</Link>
      </Button>
    </div>
  );
}

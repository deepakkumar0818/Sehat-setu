"use client";

import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatTime12h } from "@/lib/format";
import { useAvailableSlots } from "@/hooks/use-availability";
import { DEMO_NOW } from "@/lib/demo-clock";
import type { AppointmentType, Doctor } from "@/types";

function upcomingDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(DEMO_NOW);
    d.setDate(d.getDate() + i);
    return d;
  });
}

interface BookingDateTimeStepProps {
  doctor: Doctor;
  type: AppointmentType;
  onTypeChange: (type: AppointmentType) => void;
  date: string;
  onDateChange: (date: string) => void;
  time: string | null;
  onTimeChange: (time: string) => void;
}

export function BookingDateTimeStep({ doctor, type, onTypeChange, date, onDateChange, time, onTimeChange }: BookingDateTimeStepProps) {
  const days = useMemo(() => upcomingDays(10), []);
  const { data: slots, isLoading } = useAvailableSlots(doctor.id, date);
  const fee = type === "online" ? Math.round((doctor.consultationFee * 0.9) / 50) * 50 : doctor.consultationFee;

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Choose date &amp; time</h2>
      <p className="mt-1 text-sm text-muted-foreground">with {doctor.name} · {formatCurrency(fee)} consultation fee</p>

      <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Consultation type</p>
      <div className="mt-2 grid max-w-xs grid-cols-2 gap-2">
        <Button variant={type === "in_person" ? "default" : "outline"} onClick={() => onTypeChange("in_person")}>In-person</Button>
        <Button variant={type === "online" ? "default" : "outline"} onClick={() => onTypeChange("online")} disabled={!doctor.onlineConsultation}>
          Online
        </Button>
      </div>

      <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Select date</p>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const active = iso === date;
          return (
            <button
              key={iso}
              onClick={() => onDateChange(iso)}
              className={`flex min-w-14 shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 text-center transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <span className="text-[10px] uppercase opacity-80">{format(day, "EEE")}</span>
              <span className="text-sm font-semibold">{format(day, "d")}</span>
              {isSameDay(day, DEMO_NOW) && <span className="text-[9px] opacity-80">Today</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Available slots</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)
        ) : slots && slots.length > 0 ? (
          slots.map((slot) => (
            <button
              key={slot}
              onClick={() => onTimeChange(slot)}
              className={`rounded-md border px-2 py-2 text-sm font-medium transition-colors ${time === slot ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {formatTime12h(slot)}
            </button>
          ))
        ) : (
          <div className="col-span-3 sm:col-span-4">
            <EmptyState title="No available slots for this date" description="Try selecting a different date." className="border-0 py-6" />
          </div>
        )}
      </div>
    </div>
  );
}

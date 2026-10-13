"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isSameDay } from "date-fns";
import { MapPinIcon, StarIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatTime12h } from "@/lib/format";
import { demoReviewCount } from "@/lib/demo-reviews";
import { useDoctor } from "@/hooks/use-people";
import { useAvailableSlots } from "@/hooks/use-availability";
import { useDataStore } from "@/store/data-store";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import type { AppointmentType } from "@/types";

const TESTIMONIAL_QUOTES = [
  "Explained everything clearly and didn't rush the visit.",
  "Booking was quick and the doctor was on time.",
  "Very reassuring — answered all my questions patiently.",
];

function upcomingDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(DEMO_NOW);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function DoctorProfileClient({ doctorId }: { doctorId: string }) {
  const router = useRouter();
  const { data: doctor, isLoading, isError, refetch } = useDoctor(doctorId);
  const branch = useDataStore((s) => s.db.branches.find((b) => b.id === doctor?.branchId));

  const [type, setType] = useState<AppointmentType>("in_person");
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const { data: slots, isLoading: slotsLoading } = useAvailableSlots(doctorId, selectedDate);
  const days = useMemo(() => upcomingDays(7), []);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !doctor) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <ErrorState title="Doctor not found" description="This doctor profile doesn't exist or may have been removed." onRetry={() => refetch()} />
      </div>
    );
  }

  const fee = type === "online" ? Math.round((doctor.consultationFee * 0.9) / 50) * 50 : doctor.consultationFee;

  const handleBook = () => {
    const params = new URLSearchParams({ date: selectedDate, type });
    if (selectedTime) params.set("time", selectedTime);
    router.push(`/book/${doctor.id}?${params.toString()}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex flex-col gap-5 rounded-2xl border bg-card p-6 sm:flex-row sm:items-start">
            <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="xl" />
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{doctor.name}</h1>
              <p className="text-muted-foreground">{doctor.qualifications}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/20 bg-accent text-primary">{doctor.specialization}</Badge>
                <Badge variant="outline">{doctor.experienceYears} years experience</Badge>
                {doctor.onlineConsultation && (
                  <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online available</Badge>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-sm">
                <StarIcon className="h-4 w-4 fill-warning text-warning" />
                <span className="font-semibold text-foreground">{doctor.rating?.toFixed(1) ?? "—"}</span>
                <span className="text-muted-foreground">({demoReviewCount(doctor.id)} demo reviews)</span>
              </div>
            </div>
          </div>

          <Tabs defaultValue="about" className="mt-6">
            <TabsList>
              <TabsTrigger value="about">About</TabsTrigger>
              <TabsTrigger value="availability">Availability</TabsTrigger>
              <TabsTrigger value="clinic">Clinic</TabsTrigger>
              <TabsTrigger value="reviews">Reviews</TabsTrigger>
            </TabsList>

            <TabsContent value="about" className="mt-4 space-y-4">
              <div className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold text-foreground">About {doctor.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{doctor.bio}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Education</p>
                  <p className="mt-1 text-sm text-foreground">{doctor.qualifications}</p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Experience</p>
                  <p className="mt-1 text-sm text-foreground">{doctor.experienceYears} years</p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Languages</p>
                  <p className="mt-1 text-sm text-foreground">English, Hindi</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="availability" className="mt-4">
              <div className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold text-foreground">Weekly availability</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {doctor.availability.map((slot) => (
                    <div key={slot.day} className="rounded-lg border p-2.5 text-center text-sm">
                      <p className="font-medium text-foreground">{slot.day}</p>
                      <p className="text-xs text-muted-foreground">{formatTime12h(slot.start)} – {formatTime12h(slot.end)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="clinic" className="mt-4">
              {branch && (
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold text-foreground">{branch.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="h-4 w-4" /> {branch.address}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{branch.phone}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="reviews" className="mt-4 space-y-3">
              {TESTIMONIAL_QUOTES.map((quote, i) => (
                <div key={quote} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, s) => <StarIcon key={s} className="h-3.5 w-3.5 fill-warning text-warning" />)}
                  </div>
                  <p className="mt-2 text-sm text-foreground">&ldquo;{quote}&rdquo;</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">Demo Patient {i + 1}</p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Demo reviews shown for illustration.</p>
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border bg-card p-5 shadow-lg">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Consultation type</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant={type === "in_person" ? "default" : "outline"} onClick={() => setType("in_person")}>In-person</Button>
              <Button
                variant={type === "online" ? "default" : "outline"}
                onClick={() => setType("online")}
                disabled={!doctor.onlineConsultation}
              >
                Online
              </Button>
            </div>

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Select date</p>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
              {days.map((day) => {
                const iso = format(day, "yyyy-MM-dd");
                const active = iso === selectedDate;
                return (
                  <button
                    key={iso}
                    onClick={() => { setSelectedDate(iso); setSelectedTime(null); }}
                    className={`flex min-w-14 shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 text-center transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="text-[10px] uppercase opacity-80">{format(day, "EEE")}</span>
                    <span className="text-sm font-semibold">{format(day, "d")}</span>
                    {isSameDay(day, DEMO_NOW) && <span className="text-[9px] opacity-80">Today</span>}
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Available slots</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {slotsLoading ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-md" />)
              ) : slots && slots.length > 0 ? (
                slots.slice(0, 12).map((slot) => (
                  <button
                    key={slot}
                    onClick={() => setSelectedTime(slot)}
                    className={`rounded-md border px-1.5 py-1.5 text-xs font-medium transition-colors ${selectedTime === slot ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {formatTime12h(slot)}
                  </button>
                ))
              ) : (
                <div className="col-span-3">
                  <EmptyState title="No available slots" description="Try a different date." className="border-0 py-6" />
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Consultation fee</span>
              <span className="font-semibold text-foreground">{formatCurrency(fee)}</span>
            </div>
            <Button className="mt-3 w-full" size="lg" disabled={!selectedTime} onClick={handleBook}>
              Book Appointment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

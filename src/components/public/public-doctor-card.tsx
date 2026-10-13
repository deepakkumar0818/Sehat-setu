import Link from "next/link";
import { MapPinIcon, StarIcon, UsersIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatCurrency, formatFriendlyDate, formatTime12h } from "@/lib/format";
import { demoConsultationCount, demoReviewCount } from "@/lib/demo-reviews";
import type { Doctor } from "@/types";

interface PublicDoctorCardProps {
  doctor: Doctor;
  clinicName?: string;
  nextAvailable?: { date: string; time: string };
}

export function PublicDoctorCard({ doctor, clinicName, nextAvailable }: PublicDoctorCardProps) {
  return (
    <div className="group flex flex-col rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5">
      <div className="flex items-start gap-3">
        <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="lg" />
        <div className="min-w-0 flex-1">
          <Link href={`/doctors/${doctor.id}`} className="font-semibold text-foreground hover:underline">
            {doctor.name}
          </Link>
          <p className="text-sm text-muted-foreground">{doctor.qualifications}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
            <span className="flex items-center gap-1">
              <StarIcon className="h-3.5 w-3.5 fill-warning text-warning" />
              <span className="font-medium text-foreground">{doctor.rating?.toFixed(1)}</span>
              <span className="text-muted-foreground">({demoReviewCount(doctor.id)})</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <UsersIcon className="h-3.5 w-3.5" /> {demoConsultationCount(doctor.id).toLocaleString("en-IN")} consultations
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-primary/20 bg-accent text-primary">{doctor.specialization}</Badge>
        <Badge variant="outline">{doctor.experienceYears} yrs experience</Badge>
        {doctor.onlineConsultation && (
          <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online</Badge>
        )}
      </div>

      {clinicName && (
        <p className="mt-3 flex items-center gap-1 truncate text-sm text-muted-foreground">
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" /> {clinicName}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Consultation fee</p>
          <p className="font-semibold text-foreground">{formatCurrency(doctor.consultationFee)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Next available</p>
          <p className="text-sm font-medium text-success">
            {nextAvailable ? `${formatFriendlyDate(nextAvailable.date)}, ${formatTime12h(nextAvailable.time)}` : "Fully booked"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button asChild variant="outline" className="flex-1">
          <Link href={`/doctors/${doctor.id}`}>View Profile</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link href={`/book/${doctor.id}`}>Book Appointment</Link>
        </Button>
      </div>
    </div>
  );
}

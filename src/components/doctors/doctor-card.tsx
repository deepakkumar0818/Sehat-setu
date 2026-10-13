import Link from "next/link";
import { StarIcon, VideoIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/format";
import type { Doctor } from "@/types";

export function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <Link href={`/doctor-roster/${doctor.id}`}>
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex flex-col items-center gap-2 py-2 text-center">
          <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="xl" />
          <div>
            <p className="font-semibold text-foreground">{doctor.name}</p>
            <p className="text-xs text-muted-foreground">{doctor.qualifications}</p>
          </div>
          <Badge variant="outline">{doctor.specialization}</Badge>
          <p className="text-xs text-muted-foreground">{doctor.experienceYears} years experience</p>
          {doctor.rating !== null && (
            <div className="flex items-center gap-1 text-xs text-warning">
              <StarIcon className="h-3.5 w-3.5 fill-current" /> {doctor.rating.toFixed(1)}
            </div>
          )}
          <p className="text-sm font-medium text-foreground">{formatCurrency(doctor.consultationFee)}</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={doctor.status} />
            {doctor.onlineConsultation && (
              <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

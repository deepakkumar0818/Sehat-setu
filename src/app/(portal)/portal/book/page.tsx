"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalBookingOptions } from "@/hooks/use-portal";
import { CalendarPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { LivePortalBooking } from "@/components/portal/live-portal-care";
import { useLiveData } from "@/lib/data-source";

/** Demo mode books from the Appointments page's dialog (mock data). */
function DemoPortalBookPage() {
  return (
    <EmptyState
      icon={CalendarPlusIcon}
      title="Book an appointment"
      description="In the demo, appointments are booked from the Appointments page."
      action={<Button asChild><Link href="/portal/appointments">Go to Appointments</Link></Button>}
    />
  );
}

/** Live: waits for the booking options so a doctor chosen on the public site (?doctor=) can be preselected. */
function LiveBook() {
  const doctor = useSearchParams().get("doctor") ?? undefined;
  const options = usePortalBookingOptions();
  if (options.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  return <LivePortalBooking initialDoctorId={doctor} />;
}

export default function PortalBookPage() {
  // Live (signed-in patient): booking against the clinic's real schedule. Demo mode: the mock flow.
  return useLiveData() ? (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <LiveBook />
    </Suspense>
  ) : (
    <DemoPortalBookPage />
  );
}

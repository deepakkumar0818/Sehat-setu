"use client";

import Link from "next/link";
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

export default function PortalBookPage() {
  // Live (signed-in patient): booking against the clinic's real schedule. Demo mode: the mock flow.
  return useLiveData() ? <LivePortalBooking /> : <DemoPortalBookPage />;
}

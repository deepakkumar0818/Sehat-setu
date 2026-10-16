import { redirect } from "next/navigation";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import type { Metadata } from "next";
import { BookingFlow } from "@/components/public/booking/booking-flow";

export const metadata: Metadata = {
  title: "Book an Appointment | Sehat Setu",
  description: "Book an appointment with a doctor at Sehat Setu in a few simple steps.",
  robots: { index: false, follow: true },
};

export default function BookPage() {
  // Live site: booking happens in the patient portal, which asks visitors to sign in or register first.
  if (isSupabaseAuthEnabled()) redirect("/portal/book");
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <BookingFlow />
    </div>
  );
}

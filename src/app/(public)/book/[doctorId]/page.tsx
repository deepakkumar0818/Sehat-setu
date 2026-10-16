import { redirect } from "next/navigation";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import type { Metadata } from "next";
import { getDb } from "@/store/data-store";
import { BookingFlow } from "@/components/public/booking/booking-flow";

export async function generateMetadata({ params }: { params: Promise<{ doctorId: string }> }): Promise<Metadata> {
  const { doctorId } = await params;
  const doctor = getDb().doctors.find((d) => d.id === doctorId);
  return {
    title: doctor ? `Book ${doctor.name} | Sehat Setu` : "Book an Appointment | Sehat Setu",
    description: "Book an appointment with a doctor at Sehat Setu in a few simple steps.",
    robots: { index: false, follow: true },
  };
}

export default async function BookDoctorPage({ params }: { params: Promise<{ doctorId: string }> }) {
  const { doctorId } = await params;
  // Live site: book this doctor in the patient portal (sign in or register first).
  if (isSupabaseAuthEnabled()) redirect(`/portal/book?doctor=${encodeURIComponent(doctorId)}`);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <BookingFlow initialDoctorId={doctorId} />
    </div>
  );
}

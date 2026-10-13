import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicDoctorsPageClient } from "@/components/public/public-doctors-page-client";

export const metadata: Metadata = {
  title: "Find a Doctor | Sehat Setu",
  description: "Browse specialists across Sehat Setu clinics by specialty, location, and availability, and book an appointment in minutes.",
};

function DoctorsPageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Skeleton className="h-9 w-64" />
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}

export default function PublicDoctorsPage() {
  return (
    <Suspense fallback={<DoctorsPageFallback />}>
      <PublicDoctorsPageClient />
    </Suspense>
  );
}

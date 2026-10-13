"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/public/reveal";
import { PublicDoctorCard } from "@/components/public/public-doctor-card";
import { useDoctors } from "@/hooks/use-people";
import { useNextAvailableSlots } from "@/hooks/use-availability";
import { useDataStore } from "@/store/data-store";

export function DoctorDirectoryPreview() {
  const { data, isLoading } = useDoctors({ page: 1, pageSize: 6 });
  const branches = useDataStore((s) => s.db.branches);
  const doctorIds = data?.items.map((d) => d.id) ?? [];
  const { data: nextSlots } = useNextAvailableSlots(doctorIds);

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Find the right doctor for your needs</h2>
        <p className="mt-3 text-muted-foreground">Browse specialists, compare availability, and book an appointment in minutes.</p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
          : data?.items.map((doctor, i) => (
              <Reveal key={doctor.id} delay={Math.min(i * 0.06, 0.3)}>
                <PublicDoctorCard
                  doctor={doctor}
                  clinicName={branches.find((b) => b.id === doctor.branchId)?.name}
                  nextAvailable={nextSlots?.[doctor.id]}
                />
              </Reveal>
            ))}
      </div>

      <div className="mt-10 text-center">
        <Button variant="outline" size="lg" asChild>
          <Link href="/doctors">
            View All Doctors <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

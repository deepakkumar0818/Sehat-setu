"use client";

import Link from "next/link";
import { useState } from "react";
import { BuildingIcon, MapPinIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { useClinics } from "@/hooks/use-clinics";

export default function ClinicsPage() {
  const [search, setSearch] = useState("");
  const { data: clinics, isLoading } = useClinics(search);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Our Clinics</h1>
        <p className="mt-2 text-muted-foreground">Sehat Setu partner clinics across the region — visit in person or book online.</p>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search clinics or cities..." className="mt-6 sm:w-80" />

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)
        ) : clinics && clinics.length > 0 ? (
          clinics.map((clinic) => (
            <div key={clinic.id} className="flex flex-col rounded-2xl border bg-card p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary">
                <BuildingIcon className="h-5 w-5" />
              </div>
              <h2 className="mt-3 font-semibold text-foreground">{clinic.name}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="h-3.5 w-3.5" /> {clinic.city}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {clinic.specialties.slice(0, 3).map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                {clinic.specialties.length > 3 && <Badge variant="outline">+{clinic.specialties.length - 3} more</Badge>}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{clinic.doctorCount} doctors · Mon–Sat, 9 AM – 5 PM</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href={`/clinics/${clinic.id}`}>View Clinic</Link>
              </Button>
            </div>
          ))
        ) : (
          <EmptyState icon={BuildingIcon} title="No clinics found" description="Try a different search term." />
        )}
      </div>
    </div>
  );
}

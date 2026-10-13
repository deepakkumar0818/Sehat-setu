"use client";

import { useState } from "react";
import { SearchXIcon, StarIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatCurrency } from "@/lib/format";
import { useDoctors } from "@/hooks/use-people";
import { useDataStore } from "@/store/data-store";
import type { Doctor } from "@/types";

export function BookingDoctorStep({ onSelect }: { onSelect: (doctor: Doctor) => void }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useDoctors({ search, pageSize: 12 });
  const branches = useDataStore((s) => s.db.branches);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Choose a doctor</h2>
      <p className="mt-1 text-sm text-muted-foreground">Search by name or specialty to get started.</p>
      <SearchInput value={search} onChange={setSearch} placeholder="Search doctor or specialty..." className="mt-4 sm:w-80" />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : data && data.items.length > 0 ? (
          data.items.map((doctor) => (
            <button
              key={doctor.id}
              onClick={() => onSelect(doctor)}
              className="flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{doctor.name}</p>
                <p className="truncate text-xs text-muted-foreground">{doctor.specialization} · {branches.find((b) => b.id === doctor.branchId)?.city}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><StarIcon className="h-3 w-3 fill-warning text-warning" /> {doctor.rating?.toFixed(1)}</span>
                  <span className="text-xs font-medium text-foreground">{formatCurrency(doctor.consultationFee)}</span>
                  {doctor.onlineConsultation && <Badge variant="outline" className="gap-1 border-info/30 text-[10px] text-info"><VideoIcon className="h-2.5 w-2.5" /> Online</Badge>}
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="sm:col-span-2">
            <EmptyState icon={SearchXIcon} title="No doctors found" description="Try a different search term." />
          </div>
        )}
      </div>
    </div>
  );
}

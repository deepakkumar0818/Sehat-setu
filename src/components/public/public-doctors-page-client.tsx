"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarIcon, FilterIcon, MapPinIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PublicDoctorCard } from "@/components/public/public-doctor-card";
import { PageHero } from "@/components/public/page-hero";
import { SectionHeader } from "@/components/public/section-header";
import {
  DEFAULT_DOCTOR_FILTERS,
  DoctorSearchFiltersDrawer,
  DoctorSearchFiltersSidebar,
  activeFilterCount,
  type DoctorFilterState,
} from "@/components/public/doctor-search-filters";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { useDoctors } from "@/hooks/use-people";
import { useNextAvailableSlots } from "@/hooks/use-availability";
import { useDataStore } from "@/store/data-store";
import { SPECIALTY_ICONS } from "@/components/public/specialty-grid";
import { SPECIALIZATIONS } from "@/data/pools";

const POPULAR_SPECIALTIES = SPECIALIZATIONS.slice(0, 8);

export function PublicDoctorsPageClient() {
  const searchParams = useSearchParams();
  const branches = useDataStore((s) => s.db.branches);

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [filters, setFilters] = useState<DoctorFilterState>({
    ...DEFAULT_DOCTOR_FILTERS,
    specialty: searchParams.get("specialty") ?? "all",
    location: searchParams.get("location") ?? "all",
    onlineOnly: searchParams.get("online") === "true",
  });
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A link from another page (e.g. the homepage specialty grid) should still land on the right filter.
  useEffect(() => {
    const specialtyParam = searchParams.get("specialty");
    if (specialtyParam) setFilters((f) => ({ ...f, specialty: specialtyParam }));
  }, [searchParams]);

  const cities = useMemo(() => [...new Set(branches.map((b) => b.city))], [branches]);
  const branchIdForCity = useMemo(() => {
    if (filters.location === "all") return "all";
    return branches.find((b) => b.city === filters.location)?.id ?? "all";
  }, [branches, filters.location]);

  const { data, isLoading } = useDoctors({
    search,
    specialization: filters.specialty === "all" ? "all" : filters.specialty,
    branchId: branchIdForCity,
    gender: filters.gender,
    minExperience: filters.minExperience || undefined,
    maxFee: filters.maxFee || undefined,
    onlineOnly: filters.onlineOnly,
    availableToday: filters.availableToday,
    sortBy: filters.sortBy,
    page,
    pageSize: 9,
  });

  const doctorIds = data?.items.map((d) => d.id) ?? [];
  const { data: nextSlots } = useNextAvailableSlots(doctorIds);

  const updateFilters = (next: DoctorFilterState) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <>
      <PageHero
        eyebrow="Find the right care"
        heading="Find a doctor you can trust."
        description="Search trusted healthcare professionals by specialty, location, availability, and consultation type."
        footer={
          <form
            onSubmit={(e) => { e.preventDefault(); setPage(1); }}
            className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:flex-row sm:items-center sm:p-5"
          >
            <div className="relative flex-[2]">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search doctors, specialties, symptoms..."
                className="h-11 pl-9"
                aria-label="Search doctors, specialties, or symptoms"
              />
            </div>
            <div className="relative flex-1">
              <MapPinIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Select value={filters.location} onValueChange={(v) => updateFilters({ ...filters, location: v })}>
                <SelectTrigger className="h-11 w-full pl-9" aria-label="Location"><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any location</SelectItem>
                  {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1">
              <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Select
                value={filters.availableToday ? "today" : "any"}
                onValueChange={(v) => updateFilters({ ...filters, availableToday: v === "today" })}
              >
                <SelectTrigger className="h-11 w-full pl-9" aria-label="Availability"><SelectValue placeholder="Availability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any availability</SelectItem>
                  <SelectItem value="today">Available today</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" className="h-11 shrink-0">Find Doctors</Button>
          </form>
        }
      />

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader heading="Popular specialties" align="left" />
        <div className="mt-5 flex flex-wrap gap-2.5">
          {POPULAR_SPECIALTIES.map((s) => {
            const Icon = SPECIALTY_ICONS[s] ?? SearchIcon;
            const active = filters.specialty === s;
            return (
              <button
                key={s}
                onClick={() => updateFilters({ ...filters, specialty: active ? "all" : s })}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-primary/40 hover:bg-accent/40"
                }`}
              >
                <Icon className="h-4 w-4" /> {s}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <SectionHeader heading="Recommended doctors" align="left" />
          <Button variant="outline" className="gap-2 lg:hidden" onClick={() => setFiltersOpen(true)}>
            <FilterIcon className="h-4 w-4" /> Filters
            {activeFilterCount(filters) > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
                {activeFilterCount(filters)}
              </span>
            )}
          </Button>
        </div>

        <div className="mt-6 flex gap-8">
          <DoctorSearchFiltersSidebar value={filters} onChange={updateFilters} specialties={SPECIALIZATIONS} cities={cities} />

          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
              </div>
            ) : !data || data.items.length === 0 ? (
              <EmptyState
                icon={SearchXIcon}
                title="No doctors found"
                description="Try a different specialty, location, or clear some filters."
                action={activeFilterCount(filters) > 0 ? <Button onClick={() => updateFilters(DEFAULT_DOCTOR_FILTERS)}>Clear filters</Button> : undefined}
              />
            ) : (
              <>
                <p className="mb-4 text-sm text-muted-foreground">{data.total} doctor{data.total === 1 ? "" : "s"} found</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((doctor) => (
                    <PublicDoctorCard
                      key={doctor.id}
                      doctor={doctor}
                      clinicName={branches.find((b) => b.id === doctor.branchId)?.name}
                      nextAvailable={nextSlots?.[doctor.id]}
                    />
                  ))}
                </div>
                <div className="mt-6 rounded-lg border">
                  <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pb-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
        Not sure who to see?{" "}
        <Link href="/specialties" className="font-medium text-primary hover:underline">
          Browse by specialty
        </Link>
        .
      </div>

      <DoctorSearchFiltersDrawer
        value={filters}
        onChange={updateFilters}
        specialties={SPECIALIZATIONS}
        cities={cities}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
      />
    </>
  );
}

"use client";

import { FilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Gender } from "@/types";

export interface DoctorFilterState {
  specialty: string;
  location: string;
  gender: Gender | "all";
  minExperience: number;
  maxFee: number;
  onlineOnly: boolean;
  availableToday: boolean;
  sortBy: "relevance" | "experience" | "fee_low" | "fee_high" | "rating";
}

export const DEFAULT_DOCTOR_FILTERS: DoctorFilterState = {
  specialty: "all",
  location: "all",
  gender: "all",
  minExperience: 0,
  maxFee: 0,
  onlineOnly: false,
  availableToday: false,
  sortBy: "relevance",
};

export function activeFilterCount(f: DoctorFilterState): number {
  let n = 0;
  if (f.specialty !== "all") n++;
  if (f.location !== "all") n++;
  if (f.gender !== "all") n++;
  if (f.minExperience > 0) n++;
  if (f.maxFee > 0) n++;
  if (f.onlineOnly) n++;
  if (f.availableToday) n++;
  return n;
}

interface FilterFieldsProps {
  value: DoctorFilterState;
  onChange: (next: DoctorFilterState) => void;
  specialties: string[];
  cities: string[];
}

function FilterFields({ value, onChange, specialties, cities }: FilterFieldsProps) {
  const set = <K extends keyof DoctorFilterState>(key: K, v: DoctorFilterState[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Specialty</Label>
        <Select value={value.specialty} onValueChange={(v) => set("specialty", v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All specialties</SelectItem>
            {specialties.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Location</Label>
        <Select value={value.location} onValueChange={(v) => set("location", v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Sort by</Label>
        <Select value={value.sortBy} onValueChange={(v) => set("sortBy", v as DoctorFilterState["sortBy"])}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Most relevant</SelectItem>
            <SelectItem value="rating">Highest rated</SelectItem>
            <SelectItem value="experience">Most experienced</SelectItem>
            <SelectItem value="fee_low">Fee: low to high</SelectItem>
            <SelectItem value="fee_high">Fee: high to low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Gender</Label>
        <Select value={value.gender} onValueChange={(v) => set("gender", v as DoctorFilterState["gender"])}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Experience</Label>
        <Select value={String(value.minExperience)} onValueChange={(v) => set("minExperience", Number(v))}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any experience</SelectItem>
            <SelectItem value="5">5+ years</SelectItem>
            <SelectItem value="10">10+ years</SelectItem>
            <SelectItem value="15">15+ years</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Consultation fee</Label>
        <Select value={String(value.maxFee)} onValueChange={(v) => set("maxFee", Number(v))}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any fee</SelectItem>
            <SelectItem value="500">Under ₹500</SelectItem>
            <SelectItem value="1000">Under ₹1,000</SelectItem>
            <SelectItem value="1500">Under ₹1,500</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Consultation type</Label>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3">
          <Checkbox checked={value.onlineOnly} onCheckedChange={(c) => set("onlineOnly", c === true)} />
          <span className="text-sm text-foreground">Online consultation available</span>
        </label>
      </div>

      <div className="space-y-1.5">
        <Label>Availability</Label>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3">
          <Checkbox checked={value.availableToday} onCheckedChange={(c) => set("availableToday", c === true)} />
          <span className="text-sm text-foreground">Available today</span>
        </label>
      </div>

      {activeFilterCount(value) > 0 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange(DEFAULT_DOCTOR_FILTERS)}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

export function DoctorSearchFiltersSidebar({ value, onChange, specialties, cities, className }: FilterFieldsProps & { className?: string }) {
  return (
    <aside className={cn("hidden w-64 shrink-0 lg:block", className)}>
      <div className="sticky top-24 rounded-2xl border bg-card p-5">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <FilterIcon className="h-4 w-4" /> Filters
        </p>
        <FilterFields value={value} onChange={onChange} specialties={specialties} cities={cities} />
      </div>
    </aside>
  );
}

export function DoctorSearchFiltersDrawer({
  value,
  onChange,
  specialties,
  cities,
  open,
  onOpenChange,
}: FilterFieldsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><FilterIcon className="h-4 w-4" /> Filters</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <FilterFields value={value} onChange={onChange} specialties={specialties} cities={cities} />
          <SheetClose asChild>
            <Button className="mt-5 w-full">Show results</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

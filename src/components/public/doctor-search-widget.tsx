"use client";

import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDataStore } from "@/store/data-store";
import { cn } from "@/lib/utils";

interface DoctorSearchWidgetProps {
  className?: string;
  compact?: boolean;
}

export function DoctorSearchWidget({ className, compact }: DoctorSearchWidgetProps) {
  const router = useRouter();
  const branches = useDataStore((s) => s.db.branches);
  const live = isSupabaseAuthEnabled();
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [date, setDate] = useState("any");

  const cities = [...new Set(branches.map((b) => b.city))];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (location !== "all") params.set("location", location);
    if (date !== "any") params.set("date", date);
    router.push(`/doctors${params.toString() ? `?${params.toString()}` : ""}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "rounded-2xl border bg-card shadow-xl shadow-primary/5",
        compact ? "p-3" : "p-4 sm:p-5",
        className
      )}
    >
      {!compact && <p className="mb-3 px-1 text-sm font-semibold text-foreground">Find the right doctor for you</p>}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-[2]">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Doctor, specialty, or condition"
            className="h-11 pl-9"
            aria-label="Search doctor, specialty or condition"
          />
        </div>

        {/* Live site: the location and date filters come from sample data, so only the search is offered. */}
        {!live && (
        <>
        <div className="relative flex-1">
          <MapPinIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger className="h-11 w-full pl-9" aria-label="Location">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any location</SelectItem>
              {cities.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="relative flex-1">
          <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger className="h-11 w-full pl-9" aria-label="Date">
              <SelectValue placeholder="Any date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any date</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="tomorrow">Tomorrow</SelectItem>
              <SelectItem value="week">This week</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </>
        )}

        <Button type="submit" size="lg" className="h-11 shrink-0">
          Find Doctors
        </Button>
      </div>
    </form>
  );
}

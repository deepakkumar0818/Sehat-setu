"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseMedicalIcon, MapPinIcon, SearchIcon, StethoscopeIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatCurrency } from "@/lib/format";
import type { PublicDirectory, PublicDirectoryDoctor } from "@/lib/live-types";

// The signed-out website's real doctor directory (clinic database). No ratings,
// review counts or availability are invented: only what the clinic recorded.
// "Book" goes to the patient portal, which asks the visitor to sign in or
// register first.

export const bookHref = (doctorId: string) => `/portal/book?doctor=${encodeURIComponent(doctorId)}`;

function branchesOf(d: PublicDirectoryDoctor, directory: PublicDirectory) {
  return d.branchIds.map((id) => directory.branches.find((b) => b.id === id)).filter((b): b is PublicDirectory["branches"][number] => Boolean(b));
}

export function LivePublicDoctorCard({ doctor, directory }: { doctor: PublicDirectoryDoctor; directory: PublicDirectory }) {
  const branches = branchesOf(doctor, directory);
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5" data-testid="public-doctor">
      <div className="flex items-start gap-3">
        <PersonAvatar name={doctor.name} color="#2563eb" size="lg" />
        <div className="min-w-0 flex-1">
          <Link href={`/doctors/${doctor.id}`} className="font-semibold text-foreground hover:underline">{doctor.name}</Link>
          <p className="truncate text-sm text-muted-foreground">{doctor.qualifications}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-primary/20 bg-accent text-primary">{doctor.specialty}</Badge>
        {doctor.experienceYears > 0 && <Badge variant="outline">{doctor.experienceYears} yrs experience</Badge>}
        {doctor.onlineConsultation && <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online</Badge>}
      </div>
      {branches.length > 0 && (
        <p className="mt-3 flex items-center gap-1 truncate text-sm text-muted-foreground">
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" /> {branches.map((b) => `${b.name}, ${b.city}`).join(" · ")}
        </p>
      )}
      <div className="mt-auto flex items-end justify-between gap-3 border-t pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Consultation fee</p>
          <p className="font-semibold text-foreground">{formatCurrency(doctor.consultationFee)}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/doctors/${doctor.id}`}>Profile</Link></Button>
          <Button asChild size="sm"><Link href={bookHref(doctor.id)}>Book</Link></Button>
        </div>
      </div>
    </div>
  );
}

export function LivePublicDoctors({ directory, initialSearch = "" }: { directory: PublicDirectory | null; initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const [specialty, setSpecialty] = useState("all");
  const [online, setOnline] = useState(false);
  const specialties = useMemo(() => [...new Set((directory?.doctors ?? []).map((d) => d.specialty))].sort(), [directory]);

  if (!directory) {
    return <EmptyState icon={StethoscopeIcon} title="The doctor directory is unavailable right now" description="Please try again in a few minutes, or sign in to book from your patient portal." />;
  }
  const q = search.trim().toLowerCase();
  const shown = directory.doctors.filter(
    (d) =>
      (specialty === "all" || d.specialty === specialty) &&
      (!online || d.onlineConsultation) &&
      (!q || [d.name, d.specialty, d.department ?? "", d.qualifications].some((v) => v.toLowerCase().includes(q)))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search doctor or specialty..." className="pl-9" aria-label="Search doctors" />
        </div>
        <Select value={specialty} onValueChange={setSpecialty}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Specialty"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All specialties</SelectItem>
            {specialties.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant={online ? "default" : "outline"} onClick={() => setOnline((v) => !v)} aria-pressed={online}><VideoIcon /> Online consultation</Button>
      </div>

      {directory.doctors.length === 0 ? (
        <EmptyState icon={BriefcaseMedicalIcon} title="No doctors listed yet" description="Our clinic is setting up its doctors. Please check back soon or call the clinic to book." />
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchIcon} title="No doctors match" description="Try another name or specialty." />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((d) => <LivePublicDoctorCard key={d.id} doctor={d} directory={directory} />)}
        </div>
      )}
    </div>
  );
}

export function LivePublicDoctorProfile({ doctor, directory }: { doctor: PublicDirectoryDoctor; directory: PublicDirectory }) {
  const branches = branchesOf(doctor, directory);
  const clinic = directory.clinics.find((c) => c.id === doctor.clinicId);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <div className="flex items-start gap-4 rounded-2xl border bg-card p-6">
          <PersonAvatar name={doctor.name} color="#2563eb" size="lg" />
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">{doctor.name}</h1>
            <p className="text-muted-foreground">{doctor.qualifications}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="outline" className="border-primary/20 bg-accent text-primary">{doctor.specialty}</Badge>
              {doctor.department && <Badge variant="outline">{doctor.department}</Badge>}
              {doctor.experienceYears > 0 && <Badge variant="outline">{doctor.experienceYears} yrs experience</Badge>}
              {doctor.onlineConsultation && <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online consultation</Badge>}
            </div>
          </div>
        </div>
        {doctor.bio && (
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="mb-2 font-semibold text-foreground">About</h2>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{doctor.bio}</p>
          </div>
        )}
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="mb-3 font-semibold text-foreground">Where to find {doctor.name}</h2>
          <ul className="space-y-3">
            {branches.map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-sm">
                <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">{clinic ? `${clinic.name} — ` : ""}{b.name}</span>
                  <span className="block text-muted-foreground">{b.address}, {b.city} · {b.phone}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <aside className="h-fit rounded-2xl border bg-card p-6 lg:sticky lg:top-24">
        <p className="text-sm text-muted-foreground">Consultation fee</p>
        <p className="text-2xl font-semibold text-foreground">{formatCurrency(doctor.consultationFee)}</p>
        <p className="mt-3 text-sm text-muted-foreground">Clinic hours: Mon–Sat, 9:00 AM – 5:00 PM. Choose a time after signing in; reception confirms your request.</p>
        <Button asChild className="mt-4 w-full"><Link href={bookHref(doctor.id)}>Book appointment</Link></Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">New here? You can create an account on the next screen.</p>
      </aside>
    </div>
  );
}

/** Home page: up to six of the clinic's doctors (live site). Hidden when none are listed. */
export function LiveDoctorPreview({ directory }: { directory: PublicDirectory | null }) {
  if (!directory || directory.doctors.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Meet our doctors</h2>
        <p className="mt-3 text-muted-foreground">Choose a doctor and request a visit. Reception confirms your appointment.</p>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {directory.doctors.slice(0, 6).map((d) => <LivePublicDoctorCard key={d.id} doctor={d} directory={directory} />)}
      </div>
      <div className="mt-8 text-center">
        <Button asChild variant="outline"><Link href="/doctors">See all doctors</Link></Button>
      </div>
    </section>
  );
}

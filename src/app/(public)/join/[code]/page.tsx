import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalendarCheckIcon, MapPinIcon, PhoneIcon, StethoscopeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { hoursLine } from "@/lib/clinic-hours";
import { normalizeClinicCode, registerForClinicPath } from "@/lib/clinic-join";
import { formatCurrency } from "@/lib/format";
import { findClinicByCode, tryPublicDirectory } from "@/server/data/public-directory";
import { logServerError } from "@/server/log";

// A clinic's own patient link, shared by the clinic (Settings → Online
// booking). Shows that clinic and its doctors only; registering from here
// creates the patient's record in this clinic, and the portal then books with
// this clinic's doctors only.

export const metadata: Metadata = {
  title: "Register & book an appointment | Sehat Setu",
  robots: { index: false, follow: false },
};

async function clinicFor(raw: string) {
  const code = normalizeClinicCode(raw);
  if (!code) return null;
  try {
    return await findClinicByCode(code);
  } catch (err) {
    logServerError("join clinic lookup", err);
    return undefined;
  }
}

export default async function JoinClinicPage({ params }: { params: Promise<{ code: string }> }) {
  if (!isSupabaseAuthEnabled()) notFound(); // patient links exist only with the clinic database
  await connection();
  const { code } = await params;
  const clinic = await clinicFor(code);

  if (clinic === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState title="This page is unavailable right now" description="Please try again in a few minutes." />
      </div>
    );
  }
  if (!clinic) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState title="Clinic link not found" description="This link isn't valid any more. Ask your clinic for its current link." />
      </div>
    );
  }

  const directory = await tryPublicDirectory();
  const info = directory?.clinics.find((c) => c.id === clinic.id);
  const branches = directory?.branches.filter((b) => b.clinicId === clinic.id) ?? [];
  const doctors = directory?.doctors.filter((d) => d.clinicId === clinic.id) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
      <section className="rounded-2xl border bg-card p-6 sm:p-8">
        <p className="text-sm font-medium text-primary">Book an appointment</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{clinic.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {clinic.city}
          {info && ` · ${hoursLine(info.hours)}`}
        </p>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          Create your patient account with {clinic.name} to book appointments with its doctors and see your prescriptions, reports and bills online.
          {info?.onlineBooking === false && " The clinic isn't taking online bookings right now — you can still register, and call the clinic to book."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={registerForClinicPath(clinic.code)}>
              <CalendarCheckIcon className="h-4 w-4" aria-hidden /> Register &amp; book
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login?next=/portal/book">Already registered? Sign in</Link>
          </Button>
        </div>
      </section>

      {branches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Where to find us</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {branches.map((b) => (
              <div key={b.id} className="rounded-xl border bg-card p-4">
                <p className="font-medium text-foreground">{b.name}</p>
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.address}, {b.city}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><PhoneIcon className="h-4 w-4 shrink-0" aria-hidden /> {b.phone}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Our doctors</h2>
        {doctors.length === 0 ? (
          <EmptyState icon={StethoscopeIcon} title="No doctors listed yet" description="You can still register now and book once the clinic adds its doctors." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.map((d) => (
              <div key={d.id} className="flex flex-col rounded-xl border bg-card p-4" data-testid="join-doctor">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={d.name} color="#2563eb" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{d.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{d.qualifications}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="border-primary/20 bg-accent text-primary">{d.specialty}</Badge>
                  {d.experienceYears > 0 && <Badge variant="outline">{d.experienceYears} yrs experience</Badge>}
                </div>
                <p className="mt-auto pt-3 text-sm text-muted-foreground">
                  Consultation fee <span className="font-medium text-foreground">{formatCurrency(d.consultationFee)}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

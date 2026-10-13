import Link from "next/link";
import { CalendarCheckIcon, FileTextIcon, FlaskConicalIcon, PillIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/public/reveal";
import { PersonAvatar } from "@/components/shared/person-avatar";

export function PatientPortalPreview() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <div className="rounded-2xl border bg-card p-5 shadow-xl">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next appointment</p>
            <div className="mt-2 flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <PersonAvatar name="Anmol Sharma" color="#2563EB" size="md" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Dr. Anmol Sharma</p>
                <p className="text-xs text-muted-foreground">Tomorrow · 10:30 AM</p>
              </div>
              <Button size="sm" variant="outline">View</Button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border p-3 text-center">
                <PillIcon className="mx-auto h-4 w-4 text-primary" />
                <p className="mt-1.5 text-lg font-bold text-foreground">2</p>
                <p className="text-[11px] text-muted-foreground">Prescriptions</p>
              </div>
              <div className="rounded-xl border p-3 text-center">
                <FlaskConicalIcon className="mx-auto h-4 w-4 text-info" />
                <p className="mt-1.5 text-lg font-bold text-foreground">3</p>
                <p className="text-[11px] text-muted-foreground">Lab reports</p>
              </div>
              <div className="rounded-xl border p-3 text-center">
                <WalletIcon className="mx-auto h-4 w-4 text-success" />
                <p className="mt-1.5 text-lg font-bold text-foreground">₹0</p>
                <p className="text-[11px] text-muted-foreground">Pending payments</p>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="order-1 lg:order-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Patient portal</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Your health records, always within reach.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Upcoming appointments, prescriptions, lab reports, your medical timeline, and payments — all in one calm, easy-to-read place.
          </p>
          <ul className="mt-5 space-y-2.5 text-sm text-foreground">
            <li className="flex items-center gap-2"><CalendarCheckIcon className="h-4 w-4 text-primary" /> Manage every appointment in one place</li>
            <li className="flex items-center gap-2"><FileTextIcon className="h-4 w-4 text-primary" /> Download prescriptions and reports anytime</li>
          </ul>
          <Button size="lg" className="mt-6" asChild>
            <Link href="/portal">Go to Patient Portal</Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}

import Link from "next/link";
import { CameraIcon, MessageSquareIcon, MicIcon, PhoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/public/reveal";
import { PersonAvatar } from "@/components/shared/person-avatar";

export function OnlineConsultationSection() {
  return (
    <section id="online-consultation" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Consult from anywhere</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Talk to your doctor from wherever you are.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Choose an online consultation when visiting the clinic isn&apos;t convenient. Meet face-to-face over video, share your reports, and get a prescription — without leaving home.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/book?type=online">Start Online Consultation</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="/online-consultation">How Online Consultation Works</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            This is a simulated preview of the consultation experience, not a live medical session.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="overflow-hidden rounded-2xl border bg-[#0B1220] shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-white">
                <p className="text-sm font-medium">Dr. Priya Mehta</p>
                <p className="text-xs text-white/60">Dermatology</p>
              </div>
              <span className="rounded-full bg-success/20 px-2.5 py-1 text-xs font-medium text-success">04:12</span>
            </div>
            <div className="relative flex h-56 items-center justify-center bg-gradient-to-br from-[#111A2E] to-[#0B1220]">
              <PersonAvatar name="Priya Mehta" color="#0F766E" size="xl" className="h-24 w-24 text-2xl" />
              <div className="absolute bottom-3 right-3 flex h-16 w-20 items-center justify-center rounded-lg bg-black/40 ring-1 ring-white/10">
                <PersonAvatar name="Demo Patient" color="#2563EB" size="sm" />
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 border-t border-white/10 p-3.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"><MicIcon className="h-4 w-4" /></div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"><CameraIcon className="h-4 w-4" /></div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"><MessageSquareIcon className="h-4 w-4" /></div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white"><PhoneIcon className="h-4 w-4" /></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

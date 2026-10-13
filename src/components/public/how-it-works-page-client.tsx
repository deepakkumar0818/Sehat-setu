"use client";

import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  FileTextIcon,
  FolderOpenIcon,
  RepeatIcon,
  SearchIcon,
  StethoscopeIcon,
  UserRoundCheckIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { PageHero } from "@/components/public/page-hero";
import { SectionHeader } from "@/components/public/section-header";
import { FeatureCard } from "@/components/public/feature-card";
import { CTASection } from "@/components/public/cta-section";
import { Reveal } from "@/components/public/reveal";

const STEPS: { number: string; icon: LucideIcon; title: string; description: string }[] = [
  { number: "01", icon: SearchIcon, title: "Find Your Doctor", description: "Search trusted doctors by specialty, location, availability, or consultation type." },
  { number: "02", icon: CalendarDaysIcon, title: "Book Your Appointment", description: "Choose a convenient time and confirm your appointment in a few simple steps." },
  { number: "03", icon: StethoscopeIcon, title: "Meet Your Doctor", description: "Visit in person or connect through a secure online consultation." },
  { number: "04", icon: FolderOpenIcon, title: "Stay Connected", description: "Access prescriptions, reports, appointments, and health records from one place." },
];

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: CalendarCheckIcon, title: "Appointments", description: "Book, reschedule, or cancel in-person and online visits anytime." },
  { icon: FileTextIcon, title: "Prescriptions", description: "Digital prescriptions saved to your profile after every consultation." },
  { icon: FolderOpenIcon, title: "Health Reports", description: "Lab reports and documents organized and searchable in one place." },
  { icon: VideoIcon, title: "Online Consultations", description: "Secure video consultations with doctors from wherever you are." },
  { icon: RepeatIcon, title: "Doctor Follow-ups", description: "Easily book a follow-up with the same doctor after your visit." },
  { icon: UserRoundCheckIcon, title: "Health Records", description: "Your full care history, kept together and always accessible." },
];

export function HowItWorksPageClient() {
  return (
    <>
      <PageHero
        eyebrow="How Sehat Setu works"
        heading="Healthcare shouldn't feel complicated."
        description="From finding the right doctor to keeping your health records organized, Sehat Setu brings everything together."
      />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="relative">
          <div className="absolute left-6 top-6 hidden h-[calc(100%-3rem)] w-px bg-border sm:block lg:left-1/2 lg:top-10 lg:h-px lg:w-[calc(100%-5rem)] lg:-translate-x-1/2" aria-hidden="true" />
          <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <Reveal key={step.number} delay={i * 0.1} className="relative flex gap-4 lg:flex-col lg:items-center lg:text-center">
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-sm">
                  <step.icon className="h-5 w-5" />
                </div>
                <div className="lg:mt-2">
                  <p className="text-xs font-semibold tracking-widest text-primary">{step.number}</p>
                  <h3 className="mt-1 font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader heading="Everything you need, in one place." description="One connected platform for the whole care journey." />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} delay={Math.min(i * 0.06, 0.3)} />
          ))}
        </div>
      </section>

      <CTASection
        heading="Your healthcare journey starts here."
        primaryCta={{ label: "Find a Doctor", href: "/doctors", icon: SearchIcon }}
        secondaryCta={{ label: "Book an Appointment", href: "/book", icon: CalendarDaysIcon }}
      />
    </>
  );
}

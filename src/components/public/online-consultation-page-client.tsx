"use client";

import {
  CalendarClockIcon,
  ClipboardCheckIcon,
  CreditCardIcon,
  LockIcon,
  PlugZapIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserRoundSearchIcon,
  VideoIcon,
  WifiIcon,
  type LucideIcon,
} from "lucide-react";
import { PageHero } from "@/components/public/page-hero";
import { SectionHeader } from "@/components/public/section-header";
import { FeatureCard } from "@/components/public/feature-card";
import { CTASection } from "@/components/public/cta-section";
import { Reveal } from "@/components/public/reveal";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import Link from "next/link";

const BENEFITS: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: WifiIcon, title: "Convenient", description: "Talk to your doctor without travelling or waiting in a clinic." },
  { icon: LockIcon, title: "Secure", description: "Your health information and consultation stay protected." },
  { icon: CalendarClockIcon, title: "Flexible", description: "Choose a consultation time that fits your schedule." },
  { icon: PlugZapIcon, title: "Connected", description: "Prescriptions and consultation history stay together in your portal." },
];

const STEPS: { icon: LucideIcon; title: string }[] = [
  { icon: UserRoundSearchIcon, title: "Choose a doctor" },
  { icon: CalendarClockIcon, title: "Select a time" },
  { icon: CreditCardIcon, title: "Complete payment" },
  { icon: VideoIcon, title: "Join consultation" },
  { icon: ClipboardCheckIcon, title: "Access prescription" },
];

const FAQS = [
  { q: "Is online consultation as good as an in-person visit?", a: "For many follow-ups, minor concerns, and prescription renewals, yes — your doctor will let you know if an in-person visit is needed." },
  { q: "What do I need to join a consultation?", a: "A phone, tablet, or computer with a camera, microphone, and a stable internet connection. You'll get a reminder before your scheduled time." },
  { q: "Will I receive a prescription?", a: "If appropriate, your doctor issues a digital prescription right after the consultation, saved to your patient portal." },
  { q: "Can I switch to in-person if needed?", a: "Yes — your doctor can recommend an in-person visit, and you can book one directly from your portal." },
];

export function OnlineConsultationPageClient() {
  return (
    <>
      <PageHero
        eyebrow="Online consultation"
        heading="Talk to a doctor from wherever you are."
        description="Get professional medical guidance through secure online consultations with trusted doctors."
        primaryCta={{ label: "Find an Online Doctor", href: "/doctors?online=true", icon: SearchIcon }}
        secondaryCta={{ label: "How Online Consultation Works", href: "#how-it-works" }}
        visual={<ConsultationMockup />}
      />

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader heading="Why choose online consultation?" />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => (
            <FeatureCard key={b.title} icon={b.icon} title={b.title} description={b.description} delay={Math.min(i * 0.08, 0.3)} />
          ))}
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader heading="How it works" />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-5">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08} className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
                <step.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">{step.title}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Common questions</h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem key={faq.q} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">{faq.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 lg:px-8">
        <Reveal className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-muted p-5">
          <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <p className="text-sm leading-relaxed text-foreground">
            <span className="font-semibold">Online consultation is not appropriate for medical emergencies.</span>{" "}
            For emergencies, contact your local emergency services or visit the nearest emergency department.
          </p>
        </Reveal>
      </section>

      <CTASection
        heading="Ready to talk to a doctor?"
        description="Book a secure online consultation with a trusted Sehat Setu doctor in minutes."
        primaryCta={{ label: "Find an Online Doctor", href: "/doctors?online=true", icon: SearchIcon }}
      />
    </>
  );
}

function ConsultationMockup() {
  return (
    <div className="mx-auto max-w-md rounded-[1.75rem] border bg-card p-5 shadow-xl shadow-primary/5 lg:mx-0 lg:max-w-none">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-secondary/15 to-primary/10">
        <PersonAvatar name="Priya Mehta" color="#0F766E" size="xl" />
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live
        </span>
        <VideoIcon className="absolute bottom-3 right-3 h-5 w-5 text-white/70" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-foreground">Dr. Priya Mehta</p>
          <p className="text-sm text-muted-foreground">Dermatology · Online</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-success-muted px-2.5 py-1 text-xs font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" /> Available now
        </span>
      </div>

      <Button asChild size="lg" className="mt-4 w-full">
        <Link href="/doctors?online=true">Start Consultation</Link>
      </Button>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <ShieldCheckIcon className="h-4 w-4 shrink-0 text-secondary" /> End-to-end secure video consultations.
      </div>
    </div>
  );
}

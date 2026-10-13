"use client";

import {
  BarChart3Icon,
  BoxesIcon,
  CalendarDaysIcon,
  ContactIcon,
  CreditCardIcon,
  FileSignatureIcon,
  FolderOpenIcon,
  MailIcon,
  UsersIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { PageHero } from "@/components/public/page-hero";
import { SectionHeader } from "@/components/public/section-header";
import { FeatureCard } from "@/components/public/feature-card";
import { CTASection } from "@/components/public/cta-section";
import { ClinicDashboardPreview } from "@/components/public/clinic-dashboard-preview";
import { Reveal } from "@/components/public/reveal";

const DEMO_MAILTO = "mailto:hello@sehatsetu.demo?subject=Sehat%20Setu%20demo%20request";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: CalendarDaysIcon, title: "Appointment Management", description: "Manage in-person and online appointments from a single calendar." },
  { icon: UsersIcon, title: "Patient Management", description: "Complete patient profiles, history, and records in one place." },
  { icon: FileSignatureIcon, title: "Digital Prescriptions", description: "Issue and track prescriptions with built-in safety checks." },
  { icon: FolderOpenIcon, title: "Health Records", description: "Lab reports and documents organized per patient, always accessible." },
  { icon: CreditCardIcon, title: "Payments", description: "Track invoices and payments across every visit and channel." },
  { icon: VideoIcon, title: "Online Consultation", description: "Run secure video consultations alongside in-person visits." },
  { icon: BarChart3Icon, title: "Reports & Analytics", description: "See appointments, revenue, and clinic performance at a glance." },
  { icon: ContactIcon, title: "Staff Management", description: "Manage roles, permissions, and schedules for your whole team." },
];

export function ForClinicsPageClient() {
  return (
    <>
      <PageHero
        tone="clinic"
        eyebrow="For clinics & healthcare teams"
        heading="Run your clinic. We'll simplify the rest."
        description="Sehat Setu helps clinics manage appointments, patients, prescriptions, records, payments, and everyday operations from one connected platform."
        primaryCta={{ label: "Book a Demo", href: DEMO_MAILTO, icon: MailIcon }}
        secondaryCta={{ label: "Explore Features", href: "#features" }}
        visual={<ClinicDashboardPreview />}
      />

      <section id="features" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader heading="Everything your clinic needs to run smoothly." align="left" />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} delay={Math.min(i * 0.05, 0.3)} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0B1220] via-[#0F1B33] to-[#111A2E] p-8 sm:p-12">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Built for real clinics</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">Built for the way modern clinics work.</h2>
              <p className="mt-3 max-w-md text-white/65">
                One dashboard for appointments, patients, revenue, and your team — no more switching between spreadsheets, registers, and messaging apps.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <BoxesIcon className="h-4 w-4 text-primary" />
                  <p className="mt-2 text-sm font-medium text-white">Inventory tracking</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <BarChart3Icon className="h-4 w-4 text-primary" />
                  <p className="mt-2 text-sm font-medium text-white">Live analytics</p>
                </div>
              </div>
            </div>
            <ClinicDashboardPreview />
          </div>
        </Reveal>
      </section>

      <CTASection
        heading="Less administration. More time for patients."
        description="Bring your clinic onto Sehat Setu and give your team one connected place to work."
        primaryCta={{ label: "Book a Demo", href: DEMO_MAILTO, icon: MailIcon }}
      />
    </>
  );
}

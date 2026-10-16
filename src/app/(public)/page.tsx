import type { Metadata } from "next";
import { HeroSection } from "@/components/public/hero-section";
import { TrustStats } from "@/components/public/trust-stats";
import { HowItWorks } from "@/components/public/how-it-works";
import { DoctorDirectoryPreview } from "@/components/public/doctor-directory-preview";
import { SpecialtyGrid } from "@/components/public/specialty-grid";
import { OnlineConsultationSection } from "@/components/public/online-consultation-section";
import { PatientPortalPreview } from "@/components/public/patient-portal-preview";
import { AISection } from "@/components/public/ai-section";
import { ClinicSection } from "@/components/public/clinic-section";
import { TestimonialsSection } from "@/components/public/testimonials-section";
import { FAQSection } from "@/components/public/faq-section";
import { StoryBanner } from "@/components/public/story-banner";
import { SPECIALIZATIONS } from "@/data/pools";
import { connection } from "next/server";
import { LiveDoctorPreview } from "@/components/public/live-public-doctors";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { tryPublicDirectory } from "@/server/data/public-directory";

export const metadata: Metadata = {
  title: "Sehat Setu — Find Doctors & Book Healthcare Appointments",
  description: "Find doctors, book appointments, consult online, and manage your healthcare records with Sehat Setu.",
  openGraph: {
    title: "Sehat Setu — Connecting Care. Simplifying Healthcare.",
    description: "Find doctors, book appointments, consult online, and manage your healthcare records with Sehat Setu.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sehat Setu — Connecting Care. Simplifying Healthcare.",
    description: "Find doctors, book appointments, consult online, and manage your healthcare records with Sehat Setu.",
  },
};

export default async function HomePage() {
  // Live site: real doctors; sample statistics and testimonials are left out.
  const live = isSupabaseAuthEnabled();
  if (live) await connection();
  const directory = live ? await tryPublicDirectory() : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalOrganization",
    name: "Sehat Setu",
    description: "A healthcare technology platform for finding doctors, booking appointments, and managing care online.",
    slogan: "Connecting Care. Simplifying Healthcare.",
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HeroSection />
      {!live && <TrustStats />}
      <HowItWorks />
      {live ? <LiveDoctorPreview directory={directory} /> : <DoctorDirectoryPreview />}
      <SpecialtyGrid specialties={SPECIALIZATIONS} />
      <OnlineConsultationSection />
      <PatientPortalPreview />
      <AISection />
      <ClinicSection />
      {!live && <TestimonialsSection />}
      <FAQSection />
      <StoryBanner />
    </>
  );
}

"use client";

import { useMemo } from "react";
import { StarIcon } from "lucide-react";
import { PageHero } from "@/components/public/page-hero";
import { SectionHeader } from "@/components/public/section-header";
import { SpecialtyCard } from "@/components/public/specialty-card";
import { AskSehatAiButton } from "@/components/public/ask-sehat-ai-button";
import { Reveal } from "@/components/public/reveal";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useDataStore } from "@/store/data-store";
import { SPECIALTY_ICONS } from "@/components/public/specialty-grid";
import { SPECIALIZATIONS } from "@/data/pools";

const SPECIALTY_DESCRIPTIONS: Record<string, string> = {
  "General Physician": "Everyday illnesses, checkups, and the first stop for most health concerns.",
  "Internal Medicine": "Diagnosis and long-term management of adult health conditions.",
  Cardiology: "Heart health, blood pressure, and cardiovascular conditions.",
  Dermatology: "Skin, hair, and nail conditions from acne to chronic concerns.",
  Pediatrics: "Complete care for infants, children, and adolescents.",
  Gynecology: "Women's reproductive health, pregnancy, and wellness care.",
  Orthopedics: "Bones, joints, muscles, and sports injuries.",
  ENT: "Ear, nose, and throat conditions, from infections to hearing concerns.",
  Ophthalmology: "Eye exams, vision correction, and eye health conditions.",
  Psychiatry: "Mental health support, counselling, and psychiatric care.",
  Endocrinology: "Hormonal conditions including diabetes and thyroid disorders.",
  Pulmonology: "Lung and respiratory conditions, including asthma and infections.",
};

export function SpecialtiesPageClient() {
  const doctors = useDataStore((s) => s.db.doctors);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of doctors) map[d.specialization] = (map[d.specialization] ?? 0) + 1;
    return map;
  }, [doctors]);

  const featuredDoctors = useMemo(() => [...doctors].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 6), [doctors]);

  return (
    <>
      <PageHero
        eyebrow="Healthcare, organized"
        heading="Care for every stage of your health."
        description="Explore specialties and find the right medical expertise for your needs — from routine checkups to specialist care."
      />

      <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SPECIALIZATIONS.map((name, i) => (
            <SpecialtyCard
              key={name}
              icon={SPECIALTY_ICONS[name] ?? SPECIALTY_ICONS["General Physician"]}
              name={name}
              description={SPECIALTY_DESCRIPTIONS[name] ?? "Specialist care from trusted Sehat Setu doctors."}
              doctorCount={counts[name] ?? 0}
              delay={Math.min(i * 0.05, 0.35)}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal className="overflow-hidden rounded-[2rem] border bg-gradient-to-br from-accent/70 via-background to-background p-8 sm:p-12">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Meet doctors across every specialty</h2>
              <p className="mt-3 max-w-md text-muted-foreground">
                Every specialty above is backed by real, verified profiles — qualifications, experience, and patient ratings included.
              </p>
            </div>
            <div className="flex flex-wrap justify-start gap-3 lg:justify-end">
              {featuredDoctors.map((d) => (
                <div key={d.id} className="flex items-center gap-2.5 rounded-full border bg-card py-1.5 pl-1.5 pr-4">
                  <PersonAvatar name={d.name} color={d.avatarColor} size="sm" />
                  <div>
                    <p className="text-xs font-medium leading-tight text-foreground">{d.name}</p>
                    <p className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <StarIcon className="h-2.5 w-2.5 fill-warning text-warning" /> {d.rating?.toFixed(1) ?? "—"} · {d.specialization}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-20 text-center sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Not sure where to start?"
          heading="Ask Sehat AI what's going on."
          description="Tell Sehat AI what you're experiencing and we'll help point you toward the right type of care — always reviewed by a real doctor, never a diagnosis."
        />
        <div className="mt-7">
          <AskSehatAiButton />
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import {
  ActivityIcon,
  BabyIcon,
  BikeIcon,
  BoneIcon,
  BrainIcon,
  EarIcon,
  EyeIcon,
  HeartPulseIcon,
  SmileIcon,
  StethoscopeIcon,
  type LucideIcon,
  VenusIcon,
} from "lucide-react";
import { Reveal } from "@/components/public/reveal";

export const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  "General Physician": StethoscopeIcon,
  "Internal Medicine": StethoscopeIcon,
  Cardiology: HeartPulseIcon,
  Dermatology: ActivityIcon,
  Pediatrics: BabyIcon,
  Orthopedics: BoneIcon,
  Gynecology: VenusIcon,
  ENT: EarIcon,
  Dentistry: SmileIcon,
  Neurology: BrainIcon,
  Psychiatry: BrainIcon,
  Ophthalmology: EyeIcon,
  Physiotherapy: BikeIcon,
  Endocrinology: ActivityIcon,
  Pulmonology: ActivityIcon,
};

export function SpecialtyGrid({ specialties }: { specialties: string[] }) {
  return (
    <section id="specialties" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Browse by specialty</h2>
        <p className="mt-3 text-muted-foreground">Find the right kind of care for you or your family.</p>
      </Reveal>
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {specialties.map((specialty, i) => {
          const Icon = SPECIALTY_ICONS[specialty] ?? StethoscopeIcon;
          return (
            <Reveal key={specialty} delay={Math.min(i * 0.04, 0.4)}>
              <Link
                href={`/doctors?specialty=${encodeURIComponent(specialty)}`}
                className="flex flex-col items-center gap-2.5 rounded-xl border bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-foreground">{specialty}</span>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

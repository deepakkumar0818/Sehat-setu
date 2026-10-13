import Link from "next/link";
import {
  BarChart3Icon,
  BoxesIcon,
  CalendarDaysIcon,
  FileSignatureIcon,
  ReceiptIcon,
  SparklesIcon,
  StethoscopeIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/public/reveal";

const FEATURES = [
  { icon: UsersIcon, label: "Patient Management" },
  { icon: CalendarDaysIcon, label: "Appointments" },
  { icon: FileSignatureIcon, label: "Digital Prescriptions" },
  { icon: VideoIcon, label: "Online Consultation" },
  { icon: ReceiptIcon, label: "Billing & Payments" },
  { icon: StethoscopeIcon, label: "Reports" },
  { icon: BoxesIcon, label: "Inventory" },
  { icon: SparklesIcon, label: "AI Assistance" },
  { icon: BarChart3Icon, label: "Analytics" },
];

export function ClinicSection() {
  return (
    <section id="for-clinics" className="bg-muted/30 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">For clinics that want to deliver better care.</h2>
          <p className="mt-4 text-muted-foreground">
            Sehat Setu brings appointments, patients, consultations, prescriptions, reports, billing, and AI-assisted workflows into one connected platform.
          </p>
        </Reveal>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.label} delay={Math.min(i * 0.05, 0.35)}>
              <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center">
                <feature.icon className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium text-foreground">{feature.label}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/for-clinics">Explore Sehat Setu for Clinics</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="mailto:hello@sehatsetu.demo?subject=Sehat%20Setu%20demo%20request">Request a Demo</a>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}

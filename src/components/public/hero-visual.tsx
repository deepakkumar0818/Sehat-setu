"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  FileSignatureIcon,
  FileTextIcon,
  SearchIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Real cutout photo of a Sehat Setu doctor, provided as a project asset. */
const HERO_DOCTOR_IMAGE_SRC = "/hero-doctor.png";

function DoctorVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute left-1/2 top-[10%] h-[85%] w-[90%] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        aria-hidden="true"
      />
      <Image
        src={HERO_DOCTOR_IMAGE_SRC}
        alt="A smiling Sehat Setu doctor in a white coat holding a tablet"
        fill
        sizes={compact ? "280px" : "(min-width: 1280px) 380px, 300px"}
        className="object-cover object-top"
        priority
      />
    </div>
  );
}

/**
 * One-shot entrance fade/rise only — no idle loop, no parallax. Every card
 * in the hero must come to a dead stop once it lands and never move again,
 * regardless of mouse position, hover, click, or scroll.
 */
function EntranceCard({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

const SERVICES = [
  { icon: SearchIcon, label: "Find Doctors", color: "#2563EB" },
  { icon: CalendarDaysIcon, label: "Book Appointments", color: "#7C3AED" },
  { icon: VideoIcon, label: "Online Consultation", color: "#DC2626" },
  { icon: FileSignatureIcon, label: "View Prescriptions", color: "#16A34A" },
  { icon: FileTextIcon, label: "Access Reports", color: "#1D4ED8" },
];

function CardShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-xl border bg-card shadow-lg ${className ?? ""}`}>{children}</div>;
}

function DoctorCard({ className }: { className?: string } = {}) {
  return (
    <CardShell className={cn("w-52 p-3.5", className)}>
      <div className="flex items-center gap-2.5">
        <PersonAvatar name="Anmol Sharma" color="#2563EB" size="md" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">Dr. Anmol Sharma</p>
          <p className="truncate text-[11px] text-muted-foreground">Internal Medicine</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" /> Available Today
      </div>
      <button className="mt-2.5 h-7 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
        Book Now
      </button>
    </CardShell>
  );
}

function AIInsightCard() {
  return (
    <CardShell className="w-52 border-ai/25 bg-ai/15 p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ai">
        <SparklesIcon className="h-3.5 w-3.5" /> Sehat AI
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        I can help you find the right doctor for your symptoms.
      </p>
      <div className="mt-2 flex justify-end">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </CardShell>
  );
}

function AppointmentCard({ className }: { className?: string } = {}) {
  return (
    <CardShell className={cn("w-56 p-3.5", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Your Appointment</p>
        <span className="text-[10px] font-medium text-primary">Edit</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <PersonAvatar name="Priya Mehta" color="#0F766E" size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-foreground">Tomorrow, 10:30 AM</p>
          <p className="truncate text-[10px] text-muted-foreground">Dr. Priya Mehta · Dermatology</p>
        </div>
      </div>
      <div className="mt-2 flex w-fit items-center gap-1.5 rounded-md bg-success-muted px-2 py-1 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        Confirmed
      </div>
    </CardShell>
  );
}

function PrescriptionCard() {
  return (
    <CardShell className="flex w-52 items-center gap-2.5 p-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FileTextIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">Prescription Ready</p>
        <p className="truncate text-[11px] text-muted-foreground">Paracetamol 500mg</p>
      </div>
    </CardShell>
  );
}

function ServiceStack() {
  return (
    <CardShell className="w-44 space-y-0.5 p-2">
      {SERVICES.map((s) => (
        <div key={s.label} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: s.color }}
          >
            <s.icon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-[11px] font-medium text-foreground">{s.label}</span>
        </div>
      ))}
    </CardShell>
  );
}

export function HeroVisual() {
  return (
    <div className="relative mx-auto max-w-md lg:max-w-none">
      {/* Mobile / small-tablet: contained, no absolute overlays, no horizontal overflow risk */}
      <div className="lg:hidden">
        <div className="mx-auto aspect-[4/5] max-w-56 overflow-hidden rounded-3xl">
          <DoctorVisual compact />
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <DoctorCard className="w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <AppointmentCard className="w-full" />
          </div>
        </div>
      </div>

      {/* Desktop: the full composed visual — static once its entrance finishes, no parallax/tilt/idle motion */}
      <div className="relative hidden h-[560px] xl:h-[600px] lg:block">
        <div
          className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        {/* Static, deliberately: this is the main hero photo and must never shift on hover/mousemove/click. */}
        <div className="absolute bottom-0 right-[2%] top-[6%] w-[58%] overflow-hidden rounded-[2rem]">
          <DoctorVisual />
        </div>

        <div className="absolute left-0 top-[10%] z-10">
          <EntranceCard delay={0.55}>
            <DoctorCard />
          </EntranceCard>
        </div>

        <div className="absolute left-0 top-[42%] z-10">
          <EntranceCard delay={0.4}>
            <ServiceStack />
          </EntranceCard>
        </div>

        <div className="absolute right-0 top-[2%] z-10">
          <EntranceCard delay={0.7}>
            <AIInsightCard />
          </EntranceCard>
        </div>

        <div className="absolute right-0 top-[46%] z-10">
          <EntranceCard delay={0.85}>
            <AppointmentCard />
          </EntranceCard>
        </div>

        <div className="absolute bottom-[6%] right-[2%] z-10">
          <EntranceCard delay={1.0}>
            <PrescriptionCard />
          </EntranceCard>
        </div>
      </div>
    </div>
  );
}

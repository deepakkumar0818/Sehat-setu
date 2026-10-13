"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { CalendarDaysIcon, HeartHandshakeIcon, SearchIcon, ShieldCheckIcon, UsersRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/components/public/hero-visual";
import { DoctorSearchWidget } from "@/components/public/doctor-search-widget";
import { DiagonalAccentLine, DotGrid, LeafBlob } from "@/components/public/hero-decor";

const EASE = [0.16, 1, 0.3, 1] as const;

const TRUST_INDICATORS = [
  { icon: ShieldCheckIcon, label: "Trusted Healthcare Professionals" },
  { icon: UsersRoundIcon, label: "Simple & Secure Appointments" },
  { icon: HeartHandshakeIcon, label: "Your Health Records Always With You" },
];

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

export function HeroSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-accent via-accent/50 to-background p-6 sm:rounded-[2.5rem] sm:p-10 lg:p-14">
        <DotGrid className="right-8 top-8 hidden sm:block" />
        <DotGrid className="bottom-24 right-8 hidden sm:block" />
        <LeafBlob className="-left-14 top-[55%]" />
        <DiagonalAccentLine />
        <p
          className="pointer-events-none absolute bottom-8 right-10 hidden -rotate-3 font-handwriting text-xl leading-tight text-primary/70 sm:block"
          aria-hidden="true"
        >
          A healthier tomorrow
          <br />
          together
        </p>

        <div className="relative grid items-center gap-10 lg:grid-cols-5">
          <motion.div variants={container} initial="hidden" animate="visible" className="lg:col-span-2">
            <motion.span
              variants={item}
              className="inline-flex rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary shadow-sm"
            >
              Your health, connected
            </motion.span>
            <motion.h1
              variants={item}
              className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground text-balance sm:text-5xl"
            >
              Healthcare that feels simple, personal, <span className="text-primary">and connected.</span>
            </motion.h1>
            <motion.p variants={item} className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Find trusted doctors, book appointments, consult online, and keep your prescriptions and health records organized with Sehat Setu.
            </motion.p>
            <motion.div variants={item} className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/book"><CalendarDaysIcon /> Book an Appointment</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="bg-white/80">
                <Link href="/doctors"><SearchIcon /> Find a Doctor</Link>
              </Button>
            </motion.div>
            <motion.ul variants={item} className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
              {TRUST_INDICATORS.map((t) => (
                <li key={t.label} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/70 text-secondary shadow-sm">
                    <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="leading-snug">{t.label}</span>
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            className="lg:col-span-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25, ease: EASE }}
          >
            <HeroVisual />
          </motion.div>
        </div>

        <motion.div
          className="relative mt-10"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5, ease: EASE }}
        >
          <DoctorSearchWidget />
        </motion.div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiagonalAccentLine, DotGrid, LeafBlob } from "@/components/public/hero-decor";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

interface PageHeroCta {
  label: string;
  href: string;
  icon?: LucideIcon;
}

interface PageHeroProps {
  eyebrow: string;
  heading: React.ReactNode;
  description: string;
  primaryCta?: PageHeroCta;
  secondaryCta?: PageHeroCta;
  /** Right-column content for a split hero. Omit for a centered, text-only hero. */
  visual?: React.ReactNode;
  /** Content docked at the bottom of the panel, e.g. a search widget. */
  footer?: React.ReactNode;
  /** "clinic" swaps the panel to a deeper navy tone for the B2B page. */
  tone?: "patient" | "clinic";
  className?: string;
}

export function PageHero({ eyebrow, heading, description, primaryCta, secondaryCta, visual, footer, tone = "patient", className }: PageHeroProps) {
  const isClinic = tone === "clinic";

  return (
    <section className={cn("mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 sm:pt-8 lg:px-8", className)}>
      <div
        className={cn(
          "relative overflow-hidden rounded-[2rem] p-6 sm:rounded-[2.5rem] sm:p-10 lg:p-14",
          isClinic
            ? "bg-gradient-to-br from-[#0B1220] via-[#0F1B33] to-[#111A2E]"
            : "bg-gradient-to-br from-accent via-accent/50 to-background"
        )}
      >
        {!isClinic && (
          <>
            <DotGrid className="right-8 top-8 hidden sm:block" />
            <LeafBlob className="-left-14 top-[55%]" />
            <DiagonalAccentLine />
          </>
        )}
        {isClinic && (
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
        )}

        <div className={cn("relative grid items-center gap-10", visual ? "lg:grid-cols-5" : "")}>
          <motion.div variants={container} initial="hidden" animate="visible" className={visual ? "lg:col-span-2" : "mx-auto max-w-2xl text-center"}>
            <motion.span
              variants={item}
              className={cn(
                "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] shadow-sm",
                isClinic ? "bg-white/10 text-primary-foreground/90 ring-1 ring-white/15" : "bg-white/70 text-primary"
              )}
            >
              {eyebrow}
            </motion.span>
            <motion.h1
              variants={item}
              className={cn(
                "mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl",
                isClinic ? "text-white" : "text-foreground"
              )}
            >
              {heading}
            </motion.h1>
            <motion.p
              variants={item}
              className={cn(
                "mt-5 text-lg leading-relaxed",
                isClinic ? "max-w-xl text-white/70" : "max-w-xl text-muted-foreground",
                !visual && "mx-auto"
              )}
            >
              {description}
            </motion.p>
            {(primaryCta || secondaryCta) && (
              <motion.div variants={item} className={cn("mt-8 flex flex-wrap gap-3", !visual && "justify-center")}>
                {primaryCta && (
                  <Button size="lg" asChild>
                    <Link href={primaryCta.href}>
                      {primaryCta.icon && <primaryCta.icon />} {primaryCta.label}
                    </Link>
                  </Button>
                )}
                {secondaryCta && (
                  <Button size="lg" variant="outline" asChild className={isClinic ? "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" : "bg-white/80"}>
                    <Link href={secondaryCta.href}>
                      {secondaryCta.icon && <secondaryCta.icon />} {secondaryCta.label}
                    </Link>
                  </Button>
                )}
              </motion.div>
            )}
          </motion.div>

          {visual && (
            <motion.div
              className="lg:col-span-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.25, ease: EASE }}
            >
              {visual}
            </motion.div>
          )}
        </div>

        {footer && (
          <motion.div
            className="relative mt-10"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: EASE }}
          >
            {footer}
          </motion.div>
        )}
      </div>
    </section>
  );
}

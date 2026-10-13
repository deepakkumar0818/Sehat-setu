"use client";

import { ArrowRightIcon } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";

const EASE = [0.16, 1, 0.3, 1] as const;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

const revealFromLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } },
};

/**
 * No approved scenic photograph exists yet. This is a CSS/SVG illustrated
 * stand-in — swap for a real, licensed image by rendering an <img> here
 * instead once one is approved; the frame/sizing already supports either.
 */
function StoryVisual() {
  return (
    <div className="relative h-full min-h-[220px] w-full overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, #DCEEFF 0%, #EFF6FF 45%, #FDF6E9 100%)" }}
        aria-hidden="true"
      />
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path d="M0 190 L60 110 L120 170 L170 90 L230 170 L280 120 L340 175 L400 140 L400 260 L0 260 Z" fill="#BFDBFE" opacity="0.55" />
        <path d="M0 220 L90 150 L150 195 L210 130 L260 195 L330 155 L400 200 L400 260 L0 260 Z" fill="#93C5FD" opacity="0.6" />
        <path d="M150 195 L170 165 L190 195 Z" fill="#F8FAFC" opacity="0.9" />
        <path d="M210 130 L230 100 L250 130 Z" fill="#F8FAFC" opacity="0.9" />
        <g opacity="0.85">
          <path d="M60 230 L60 210 L78 210 L78 230 Z" fill="#1D4ED8" opacity="0.35" />
          <path d="M55 210 L69 196 L83 210 Z" fill="#1D4ED8" opacity="0.45" />
          <path d="M95 234 L95 214 L111 214 L111 234 Z" fill="#0F766E" opacity="0.3" />
          <path d="M90 214 L103 202 L116 214 Z" fill="#0F766E" opacity="0.4" />
        </g>
        <circle cx="103" cy="221" r="3" fill="#2563EB" />
      </svg>
    </div>
  );
}

export function StoryBanner() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="grid overflow-hidden rounded-3xl border bg-card lg:grid-cols-5"
      >
        <motion.div variants={revealFromLeft} className="order-2 min-h-[200px] lg:order-1 lg:col-span-2">
          <StoryVisual />
        </motion.div>

        <div className="order-1 flex flex-col justify-center p-8 sm:p-10 lg:order-2 lg:col-span-3 lg:p-12">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Care beyond boundaries
          </motion.p>
          <motion.h2 variants={fadeUp} className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            From small towns to brighter tomorrows
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 max-w-md text-muted-foreground">
            Bringing quality healthcare closer to every community.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-6">
            <Button size="lg" variant="outline" asChild className="group">
              <a href="#testimonials">
                Our Story
                <ArrowRightIcon className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}

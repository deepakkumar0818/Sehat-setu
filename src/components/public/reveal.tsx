"use client";

import { motion, type Variants } from "framer-motion";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

/**
 * Fades/slides content in once as it enters the viewport.
 *
 * Always renders the same `motion.div` with the same `initial` value on the
 * server and on the client's first render — branching structure or `initial`
 * on `useReducedMotion()` here causes a hydration mismatch, because that hook
 * can resolve synchronously (and differently) on the client's very first
 * render, whereas the server always assumes no preference. The one-shot,
 * small-amplitude reveal below is not the kind of motion
 * `prefers-reduced-motion` primarily targets (unlike loops/parallax, which
 * this component doesn't have).
 */
export function Reveal({ children, className, delay = 0, y = 16 }: RevealProps) {
  const variants: Variants = {
    hidden: { opacity: 0, y },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      variants={variants}
    >
      {children}
    </motion.div>
  );
}

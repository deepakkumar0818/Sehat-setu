import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/public/reveal";
import { cn } from "@/lib/utils";

interface CTAAction {
  label: string;
  href: string;
  icon?: LucideIcon;
}

interface CTASectionProps {
  heading: string;
  description?: string;
  primaryCta: CTAAction;
  secondaryCta?: CTAAction;
  variant?: "primary" | "muted";
}

export function CTASection({ heading, description, primaryCta, secondaryCta, variant = "primary" }: CTASectionProps) {
  const isPrimary = variant === "primary";

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <Reveal
        className={cn(
          "relative overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-14",
          isPrimary ? "bg-primary" : "border bg-muted/30"
        )}
      >
        {isPrimary && (
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_0%,rgba(255,255,255,0.12),transparent_60%)]" aria-hidden="true" />
        )}
        <div className="relative">
          <h2 className={cn("text-3xl font-bold tracking-tight sm:text-4xl", isPrimary ? "text-white" : "text-foreground")}>{heading}</h2>
          {description && <p className={cn("mx-auto mt-4 max-w-xl", isPrimary ? "text-white/85" : "text-muted-foreground")}>{description}</p>}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant={isPrimary ? "secondary" : "default"} asChild>
              <Link href={primaryCta.href}>
                {primaryCta.icon && <primaryCta.icon />} {primaryCta.label}
              </Link>
            </Button>
            {secondaryCta && (
              <Button
                size="lg"
                variant="outline"
                asChild
                className={isPrimary ? "border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" : ""}
              >
                <Link href={secondaryCta.href}>
                  {secondaryCta.icon && <secondaryCta.icon />} {secondaryCta.label}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

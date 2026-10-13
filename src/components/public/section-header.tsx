import { Reveal } from "@/components/public/reveal";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  eyebrow?: string;
  heading: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}

export function SectionHeader({ eyebrow, heading, description, align = "center", className }: SectionHeaderProps) {
  return (
    <Reveal className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}>
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>}
      <h2 className={cn("text-3xl font-bold tracking-tight text-foreground sm:text-4xl", eyebrow && "mt-3")}>{heading}</h2>
      {description && <p className="mt-3 text-muted-foreground">{description}</p>}
    </Reveal>
  );
}

import type { LucideIcon } from "lucide-react";
import { Reveal } from "@/components/public/reveal";
import { cn } from "@/lib/utils";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  delay?: number;
  tone?: "light" | "dark";
}

export function FeatureCard({ icon: Icon, title, description, delay = 0, tone = "light" }: FeatureCardProps) {
  return (
    <Reveal delay={delay} className="h-full">
      <div
        className={cn(
          "flex h-full flex-col gap-3 rounded-2xl border p-5 transition-shadow hover:shadow-md",
          tone === "dark" ? "border-white/10 bg-white/5" : "border-border bg-card"
        )}
      >
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", tone === "dark" ? "bg-primary/20 text-primary-foreground" : "bg-accent text-primary")}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className={cn("font-semibold", tone === "dark" ? "text-white" : "text-foreground")}>{title}</h3>
          <p className={cn("mt-1 text-sm leading-relaxed", tone === "dark" ? "text-white/65" : "text-muted-foreground")}>{description}</p>
        </div>
      </div>
    </Reveal>
  );
}

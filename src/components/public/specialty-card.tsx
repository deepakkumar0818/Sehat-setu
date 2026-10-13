import Link from "next/link";
import { ArrowRightIcon, type LucideIcon } from "lucide-react";
import { Reveal } from "@/components/public/reveal";

interface SpecialtyCardProps {
  icon: LucideIcon;
  name: string;
  description: string;
  doctorCount: number;
  delay?: number;
}

export function SpecialtyCard({ icon: Icon, name, description, doctorCount, delay = 0 }: SpecialtyCardProps) {
  return (
    <Reveal delay={delay} className="h-full">
      <Link
        href={`/doctors?specialty=${encodeURIComponent(name)}`}
        className="group flex h-full flex-col rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="mt-4 font-semibold text-foreground">{name}</h3>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="text-xs text-muted-foreground">{doctorCount} doctor{doctorCount === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-1 text-sm font-medium text-primary">
            Explore Doctors <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </Reveal>
  );
}

import { Reveal } from "@/components/public/reveal";

const STATS = [
  { value: "10,000+", label: "Patient appointments" },
  { value: "250+", label: "Healthcare professionals" },
  { value: "50+", label: "Partner clinics" },
  { value: "24/7", label: "Digital access" },
];

export function TrustStats() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-center text-sm font-medium text-muted-foreground">Healthcare made simpler</p>
        </Reveal>
        <div className="mt-8 grid grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 0.08} className="text-center">
              <p className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">Illustrative demo figures for this product prototype.</p>
      </div>
    </section>
  );
}

import { CalendarCheckIcon, FolderHeartIcon, SearchIcon, StethoscopeIcon } from "lucide-react";
import { Reveal } from "@/components/public/reveal";

const STEPS = [
  { icon: SearchIcon, title: "Find a Doctor", copy: "Search by specialty, doctor, clinic, or service." },
  { icon: CalendarCheckIcon, title: "Book a Time", copy: "Choose a convenient date and available time slot." },
  { icon: StethoscopeIcon, title: "Meet Your Doctor", copy: "Visit the clinic or join your consultation online." },
  { icon: FolderHeartIcon, title: "Manage Your Care", copy: "Access prescriptions, reports, appointments, and payments from one place." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Getting care is now simpler.</h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.1}>
            <div className="relative rounded-2xl border bg-card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary">
                <step.icon className="h-5 w-5" />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.copy}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

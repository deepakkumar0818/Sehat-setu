import { SparklesIcon } from "lucide-react";
import { Reveal } from "@/components/public/reveal";
import { AIBadge } from "@/components/shared/ai-panel";

const EXCHANGES = [
  { question: "Show my latest report.", answer: "Your latest report was uploaded on September 3. You can view it from your Reports section." },
  { question: "I want a dermatologist tomorrow.", answer: "I found 3 available dermatologists tomorrow. Would you like to view them?" },
];

export function AISection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ai">
            <SparklesIcon className="h-3.5 w-3.5" /> Meet Sehat AI
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Helpful intelligence built into your healthcare experience.
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">Sehat AI helps you find doctors, navigate appointments, and understand your records — and helps doctors and clinics work more efficiently too.</p>
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            <li>• Find doctors and check availability</li>
            <li>• Explain reports and prescriptions in plain language</li>
            <li>• Help doctors organize consultation notes</li>
            <li>• Help clinics understand day-to-day operations</li>
          </ul>
          <p className="mt-5 max-w-md rounded-lg border border-ai/20 bg-ai-muted/40 p-3 text-xs text-muted-foreground">
            AI-generated assistance may contain errors. Clinical decisions should be made by qualified healthcare professionals.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rounded-2xl border bg-card p-4 shadow-xl">
            <div className="flex items-center gap-2 border-b pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ai/15 text-ai"><SparklesIcon className="h-4 w-4" /></div>
              <p className="text-sm font-semibold text-foreground">Sehat AI</p>
            </div>
            <div className="mt-3 space-y-3">
              {EXCHANGES.map((ex) => (
                <div key={ex.question} className="space-y-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground">{ex.question}</div>
                  <div className="max-w-[90%] space-y-1.5 rounded-2xl bg-muted px-3.5 py-2 text-sm text-foreground">
                    <p>{ex.answer}</p>
                    <AIBadge />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

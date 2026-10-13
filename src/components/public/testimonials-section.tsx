import { QuoteIcon } from "lucide-react";
import { Reveal } from "@/components/public/reveal";
import { PersonAvatar } from "@/components/shared/person-avatar";

const TESTIMONIALS = [
  { quote: "Booking an appointment was much easier than calling the clinic.", name: "Demo Patient", context: "Chandigarh" },
  { quote: "I can finally keep my prescriptions and reports in one place.", name: "Demo Patient", context: "Mohali" },
  { quote: "The online consultation saved me a trip to the clinic for a simple follow-up.", name: "Demo Patient", context: "Delhi" },
];

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">What patients say</h2>
        <p className="mt-3 text-sm text-muted-foreground">Fictional demo testimonials illustrating the experience.</p>
      </Reveal>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={t.quote} delay={i * 0.1}>
            <div className="flex h-full flex-col rounded-2xl border bg-card p-6">
              <QuoteIcon className="h-5 w-5 text-primary/40" />
              <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-5 flex items-center gap-2.5">
                <PersonAvatar name={t.name} color="#0F766E" size="sm" />
                <div>
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.context}</p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

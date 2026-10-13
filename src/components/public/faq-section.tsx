import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Reveal } from "@/components/public/reveal";

const FAQS = [
  { q: "How do I book an appointment?", a: "Search for a doctor or specialty, pick an available date and time, and confirm your details — you can book in a couple of minutes without calling the clinic." },
  { q: "Can I consult a doctor online?", a: "Yes. Choose \"Online\" as the consultation type when booking, and you'll join a video consultation at your scheduled time." },
  { q: "Can I cancel or reschedule my appointment?", a: "Yes, from your patient portal under Appointments — cancellations and rescheduling are self-serve." },
  { q: "Can I access my prescriptions online?", a: "Yes. Every prescription from your visits is saved to your patient portal, viewable and printable anytime." },
  { q: "Can I view my lab reports?", a: "Yes, reports appear in your portal as soon as they're uploaded, along with an optional plain-language AI explanation." },
  { q: "How are online consultation payments handled?", a: "Payment is collected securely at booking using UPI, card, or net banking, shown clearly before you confirm." },
  { q: "Is Sehat Setu a replacement for my doctor?", a: "No. Sehat Setu helps you find and connect with real doctors — all diagnosis, treatment, and prescriptions come from qualified healthcare professionals." },
  { q: "How does Sehat AI work?", a: "Sehat AI answers questions using your own account information (appointments, prescriptions, reports) and general platform guidance. It's assistance, not medical advice — see our AI disclaimer." },
  { q: "Is my health information secure?", a: "Your healthcare information is handled with security and privacy in mind, and access is controlled by role and account permissions." },
];

export function FAQSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Frequently asked questions</h2>
      </Reveal>
      <Reveal delay={0.1} className="mt-10">
        <Accordion type="single" collapsible className="w-full">
          {FAQS.map((faq, i) => (
            <AccordionItem key={faq.q} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base font-medium">{faq.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}
